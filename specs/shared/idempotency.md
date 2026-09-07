# Spec — Idempotency (Sprint 0B)

## Problem Statement

Network retries and double-submits can cause duplicate mutations (duplicate
orders, double charges, double inventory decrements). Idempotency keys prevent
this without requiring clients to implement complex deduplication logic.

## Design

Clients send an `Idempotency-Key` header (UUID) with write requests. The server
stores the key and the response. Duplicate requests with the same key return the
cached response without re-executing the handler.

Keys are scoped to a tenant so key collisions between tenants are impossible.

## Schema

Table: `idempotency_keys`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK tenants NOT NULL | Scoped per tenant |
| key | VARCHAR(255) NOT NULL | Client-supplied UUID |
| request_hash | VARCHAR(255) nullable | SHA-256 of method+path+body |
| response_status | INTEGER nullable | HTTP status of original response |
| response_body | JSONB nullable | Body of original response |
| created_at | TIMESTAMPTZ NOT NULL | |
| expires_at | TIMESTAMPTZ NOT NULL | DEFAULT 24h from creation |
| UNIQUE(tenant_id, key) | | |

## Service Interface

```python
# Check before handler
existing = idempotency_service.get(db, tenant_id=tid, key=key)
if existing and existing.response_status:
    return JSONResponse(existing.response_body, status_code=existing.response_status)

# Store after handler
idempotency_service.store(
    db, tenant_id=tid, key=key,
    request_hash=hash, response_status=201, response_body={...}
)
```

## Behavior Rules

- Key must be a valid UUID string; invalid format → 422.
- If the same key is submitted with a different `request_hash` → 400
  ("Idempotency key reuse with different request").
- The response-retention marker is 24 hours by default, configured independently
  from authentication token TTLs. It never makes a key reusable.
- The current database column keeps its legacy `expires_at` name for rolling
  deployment compatibility; application code treats it only as that marker.
- A `(tenant_id, key)` reservation is retained for the tenant lifetime. The same
  request hash replays the winning response even after the marker; another hash
  remains a conflict and cannot execute a second effect.
- Automated age-based deletion of completed keys is forbidden. Keys may be
  removed only with the complete tenant ownership graph, after the associated
  orders, refunds, cash movements and other effects are deleted. Future payload
  compaction must retain the unique key, request hash and immutable winning
  operation identity.
- Concurrent requests with the same new key: first writer wins; second sees the
  stored response (handled at DB level via UNIQUE constraint + retry logic).
- Idempotency is **optional** for all endpoints in Sprint 0B — clients may omit
  the header. It becomes **required** on `POST /orders` in Sprint 2.

## Endpoints Requiring Idempotency-Key in Future Sprints

Sprint 2+: `POST /orders`, `POST /payments`, `POST /refunds`, sync endpoint.

Sprint 0B: The infrastructure is built and used on `POST /auth/signup` as a
demonstration. The `Idempotency-Key` header is accepted but optional.

## RLS

`idempotency_keys` has RLS enabled; rows visible only to their tenant.

## Test Requirements

- Duplicate `Idempotency-Key` on signup returns cached response (201) without
  creating a second user.
- Different `Idempotency-Key` on signup creates a second user (distinct keys).
- Reuse of key with different body returns 422.

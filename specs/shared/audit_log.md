# Spec — Audit Log (Sprint 0B)

## Problem Statement

Important mutations must be traceable for compliance, debugging, and security
review. The audit log must be append-only and must not be deletable by tenants.

## Design

- Append-only table `audit_logs`.
- Written synchronously within the same request transaction.
- Never modified or deleted by application code.
- Queryable by tenant (owner/admin only, future sprint).

## Schema

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | gen_random_uuid() |
| tenant_id | UUID FK tenants nullable | Null for system-level events |
| user_id | UUID FK users nullable | Null for system-level events |
| action | VARCHAR(100) NOT NULL | e.g. `user.login`, `order.create` |
| resource_type | VARCHAR(100) nullable | e.g. `user`, `order` |
| resource_id | UUID nullable | Primary key of affected resource |
| changes | JSONB nullable | `{"before": {...}, "after": {...}}` or relevant payload |
| ip_address | VARCHAR(45) nullable | From request |
| created_at | TIMESTAMPTZ NOT NULL | DEFAULT now() |

## Action Naming Convention

`<domain>.<verb>` using snake_case:

```
user.signup       user.login         user.logout
user.logout_all   user.password_reset
order.create      order.refund       order.void
shift.open        shift.close
catalog.product_create  catalog.product_update  catalog.product_delete
inventory.adjust
billing.subscription_created  billing.payment_failed
```

## Sprint 0B Actions

`user.signup`, `user.login`, `user.logout`, `user.logout_all`, `user.password_reset`

## Service Interface

```python
audit_service.log(
    db=db,
    action="user.login",
    tenant_id=tenant_id,       # UUID or None
    user_id=user_id,           # UUID or None
    resource_type="user",      # str or None
    resource_id=user_id,       # UUID or None
    changes=None,              # dict or None
    ip_address=request.client.host,  # str or None
)
```

## Non-Negotiable Rules

- No `UPDATE` or `DELETE` on `audit_logs` in application code.
- Log writes must not fail silently (let exceptions propagate).
- `tenant_id` must be set for all tenant-context events.
- Audit logs are written in the same DB transaction as the mutation. If the
  mutation rolls back, the audit log row rolls back too (correct behavior —
  don't log events that didn't happen).

## RLS

`audit_logs` has RLS enabled. Tenants can only read their own rows. The
application layer enforces the same filter. Write is unrestricted at DB level
(the app controls inserts via the service layer).

## API Impact

No public API for audit logs in Sprint 0B. A future sprint adds a read endpoint
for owners.

## Test Requirements

- Signup creates an `audit_log` row with action `user.signup`.
- Login creates an `audit_log` row with action `user.login`.
- Audit log row has correct `tenant_id` and `user_id`.

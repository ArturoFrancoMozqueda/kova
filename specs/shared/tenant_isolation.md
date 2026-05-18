# Spec — Tenant Isolation (Sprint 0B)

## Problem Statement

The platform is multi-tenant. Every tenant must only ever see its own data.
A bug in tenant isolation is a data-breach-severity incident.

## Enforcement Layers

Two independent layers enforce isolation. Both must hold:

### Layer 1 — Application / Service Layer (Primary)

Every repository query that touches tenant-scoped data must include an explicit
`WHERE tenant_id = :tenant_id` filter derived from the authenticated session.

The `tenant_id` is extracted from the JWT (`tid` claim) and stored on the
`Session` record. It is injected via a FastAPI dependency (`get_tenant_id`)
and must be passed to every repository method that queries tenant-scoped tables.

No repository method on a tenant-scoped table may omit the `tenant_id` filter.

### Layer 2 — PostgreSQL Row-Level Security (Defense in Depth)

RLS is enabled on all tenant-scoped tables. The policy uses
`current_setting('app.tenant_id', true)` to reject rows that don't match.

The application sets `SET LOCAL app.tenant_id = '<uuid>'` at the start of each
database transaction for authenticated requests. This is done in the `get_db`
dependency when a tenant context is available.

If the application layer fails to scope a query, RLS provides a second barrier.

## Tenant-Scoped Tables (Sprint 0B)

| Table | tenant_id column | RLS enabled |
|---|---|---|
| memberships | tenant_id | Yes |
| sessions | tenant_id | Yes |
| audit_logs | tenant_id (nullable) | Yes |
| idempotency_keys | tenant_id | Yes |

Future sprints add: products, categories, orders, payments, shifts, etc.

## Tables Without tenant_id

| Table | Reason |
|---|---|
| tenants | Is the root tenant record itself |
| users | Global identity; isolated via memberships |
| roles | Reference data, not tenant-owned |
| permissions | Reference data, not tenant-owned |
| role_permissions | Reference data, not tenant-owned |
| verification_tokens | Keyed to user_id, access controlled via auth flow |
| alembic_version | Migration metadata |

See `docs/adr/ADR-009-backend-only-rls-no-policy-tables.md` for the accepted
decision on backend-only tables where RLS is enabled without tenant policies.

## Invariants

- Inserting a tenant-scoped row without `tenant_id` must fail (NOT NULL constraint).
- A query with `tenant_id = A` must never return rows belonging to `tenant_id = B`.
- A session created for tenant A must not grant access to tenant B.
- Tenant-scoped join tables must carry `tenant_id` or have a documented ADR exception.
- Cross-tenant joins must be blocked by application checks and database constraints.
- Audit logs with `tenant_id IS NULL` must not be visible to every tenant. Beta
  application audit events should carry a concrete tenant ID.
- RLS policy violations must return empty results (not errors) to avoid leaking
  tenant existence.

## Test Requirements

Every tenant-scoped resource must have at least one test that:

1. Creates records for Tenant A.
2. Authenticates as Tenant B.
3. Asserts that Tenant B cannot read, modify, or delete Tenant A's records.

Sprint 0B test target: `memberships` and `audit_logs` isolation.
Future sprints add isolation tests for their own resources.

## API Impact

No new endpoints. Every authenticated endpoint implicitly enforces isolation
through the `get_tenant_id` dependency.

## Migration Notes

Each migration that creates a tenant-scoped table must:
1. Add a `tenant_id UUID NOT NULL` column with FK to `tenants.id`.
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
3. `CREATE POLICY tenant_isolation ON ... USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`.

## Hard Gate

Tenant isolation tests are a hard gate for beta per `CLAUDE.md §Hard Gates`.

# ADR-009: Backend-Only Tables With RLS Enabled And No Tenant Policy

Date: 2026-05-18

## Status

Accepted

## Context

Supabase advisor reports `rls_enabled_no_policy` for several tables:

- `tenants`
- `users`
- `roles`
- `permissions`
- `role_permissions`
- `verification_tokens`
- `alembic_version`

These tables are not tenant-scoped domain tables in the same way as catalog, orders, shifts, inventory, billing, or modifiers.

## Decision

Keep RLS enabled with no tenant policy on these backend-only tables for beta, and do not expose them through Supabase client-side APIs.

Access is mediated by the FastAPI backend:

- `tenants` is the root business account record.
- `users` is global identity data and is scoped through `memberships`.
- `roles`, `permissions`, and `role_permissions` are static reference data.
- `verification_tokens` is used by auth flows before a tenant context exists.
- `alembic_version` is migration metadata.

Adding tenant policies directly to `users` or `verification_tokens` would be risky because signup, login, email verification, and password reset must query those tables before `app.tenant_id` is available.

## Update (2026-07-08, PLAN-02): RLS is now enforced at runtime

The original decision left tenant policies **authored but inert**: the backend connected as the Supabase `postgres` owner, which bypasses `ENABLE ROW LEVEL SECURITY`. PLAN-02 makes RLS a real runtime guarantee:

- The application now connects as a dedicated **non-owner, `NOSUPERUSER NOBYPASSRLS` role, `kova_app`** (`APP_DATABASE_URL`). Migrations and the deliberately tenant-agnostic paths use the owner role (`MIGRATION_DATABASE_URL`) via a separate privileged engine. See [db.py](../../backend/app/db.py) and [provision_app_role.sql](../../backend/scripts/provision_app_role.sql).
- Every tenant-scoped table now has `FORCE ROW LEVEL SECURITY` and write-capable policies carry `WITH CHECK` (migration `0036_force_rls`), so a mismatched-tenant INSERT/UPDATE is rejected, not just filtered on read.
- The pre-tenant-context paths this ADR flagged (signup, login, verify, password reset) plus the Stripe webhook, internal endpoints, and public asset reads are the **only** sanctioned RLS-bypass paths, and they run explicitly on the privileged (owner) engine. `membership_invitations` regained a standard tenant policy for its authenticated operations; its unauthenticated preview/accept run on the privileged engine.
- `app/tests/test_rls_enforcement.py` connects as `kova_app` and proves cross-tenant reads and mismatched writes are blocked at the SQL layer.

The backend-only no-policy tables listed above are unchanged — they intentionally keep RLS enabled with no tenant policy and are never exposed to client-side Supabase access.

## Consequences

- Supabase advisor will continue reporting these `INFO` findings.
- These tables must not be queried from frontend Supabase clients.
- Tenant-owned business data must continue to use explicit `tenant_id`, application scoping, and RLS policies.
- If direct client-side Supabase access is introduced later, this ADR must be revisited before launch.

## Follow-Up

- Keep endpoint-level auth/session tests around signup, login, verification, and password reset.
- Continue adding tenant isolation tests for tenant-scoped routes.
- ✅ Separate least-privilege runtime role (`kova_app`) added in PLAN-02 (see Update above).
- Add a boot-time posture check in production (implemented: `assert_rls_active` in [db.py](../../backend/app/db.py)) and alert if the app ever connects as an owner/superuser/BYPASSRLS role.

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

## Consequences

- Supabase advisor will continue reporting these `INFO` findings.
- These tables must not be queried from frontend Supabase clients.
- Tenant-owned business data must continue to use explicit `tenant_id`, application scoping, and RLS policies.
- If direct client-side Supabase access is introduced later, this ADR must be revisited before launch.

## Follow-Up

- Keep endpoint-level auth/session tests around signup, login, verification, and password reset.
- Continue adding tenant isolation tests for tenant-scoped routes.
- Consider adding separate backend-only database roles before GA if the deployment model changes.

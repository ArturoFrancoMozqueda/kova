# Current Sprint

## Active Sprint

Sprint: 0B — Security + Multi-Tenant Foundation

## Sprint Goal

Establish tenant isolation, auth foundation, sessions, RBAC skeleton, audit logs,
and idempotency infrastructure. No product features yet.

## Allowed Work

Only work on:

- `tenants`, `users`, `memberships` tables and models
- `roles`, `permissions`, `role_permissions` tables and seed data
- `sessions`, `verification_tokens` tables
- `audit_logs`, `idempotency_keys` tables
- Row-Level Security policies on tenant-scoped tables
- Tenant context middleware / dependency
- Auth endpoints: signup, email verify, login, refresh, logout, logout-all, password-reset
- RBAC skeleton: permission constants, role-permission mapping, `require_permission` dependency
- Audit log service (write only, append-only)
- Idempotency service
- Tenant isolation tests
- Auth/session tests
- Permission denied tests
- Related Alembic migrations (0002–0005)

## Explicitly Not Allowed This Sprint

Do not implement:

- Catalog
- Register / cart
- Orders / payments
- Billing / Stripe
- Offline sync
- Refunds / shifts / inventory / reporting
- Frontend auth UI (deferred to Sprint 0C or later)
- Email service integration (stub with dev token in response when APP_ENV=local)
- Multi-location
- Any deferred scope from docs/deferred-scope.md

## Required Specs

- `specs/auth/sessions.md`
- `specs/shared/tenant_isolation.md`
- `specs/shared/authz.md`
- `specs/shared/audit_log.md`
- `specs/shared/idempotency.md`

These must exist before implementation begins.

## Required BDD / Test Scenarios

- Signup creates tenant + user + membership.
- Duplicate signup email returns 400.
- Email verification marks user verified.
- Login sets httpOnly cookies.
- Authenticated request to `/api/v1/me` returns correct tenant-scoped user.
- Unauthenticated request returns 401.
- Refresh rotates refresh token.
- Logout revokes session; subsequent request returns 401.
- Logout-all revokes all sessions.
- Revoked session returns 401.
- Tenant A cannot access Tenant B's data.
- Request without required permission returns 403.
- Password reset flow works end-to-end.
- Idempotency-Key deduplicates concurrent writes.
- Audit log row is written for signup and login.

## Sprint 0B Tasks

### Database

- [x] Create `tenants` table (Alembic 0002).
- [x] Create `users` table (Alembic 0002).
- [x] Create `memberships` table (Alembic 0002).
- [x] Create `roles` table (Alembic 0003).
- [x] Create `permissions` table (Alembic 0003).
- [x] Create `role_permissions` table (Alembic 0003).
- [x] Seed roles and permissions (Alembic 0003).
- [x] Create `sessions` table (Alembic 0004).
- [x] Create `verification_tokens` table (Alembic 0004).
- [x] Create `audit_logs` table (Alembic 0005).
- [x] Create `idempotency_keys` table (Alembic 0005).
- [x] Add RLS policies on tenant-scoped tables.

### Backend

- [x] Add auth settings to config (secret_key, token TTLs, cookie_secure).
- [x] Add SQLAlchemy Base and get_db dependency.
- [x] Add shared exceptions and dependencies.
- [x] Add tenants module (model, schema, repository).
- [x] Add auth module (models, schemas, service, router).
- [x] Add RBAC module (permission constants, role mapping, require_permission).
- [x] Add audit log module (model, service).
- [x] Add idempotency module (model, service).
- [x] Wire all routers into main.py.
- [x] Add POST /api/v1/auth/signup.
- [x] Add POST /api/v1/auth/verify.
- [x] Add POST /api/v1/auth/login.
- [x] Add POST /api/v1/auth/refresh.
- [x] Add POST /api/v1/auth/logout.
- [x] Add POST /api/v1/auth/logout-all.
- [x] Add POST /api/v1/auth/password-reset/request.
- [x] Add POST /api/v1/auth/password-reset/confirm.
- [x] Add GET /api/v1/me.

### Tests

- [x] Auth flow tests (signup → verify → login → refresh → logout).
- [x] Session revocation tests.
- [x] Tenant isolation tests (cross-tenant access denied).
- [x] Permission denied tests.

## Definition of Done

- All auth endpoints work end-to-end.
- Tenant isolation tests pass.
- Session revocation works.
- A write endpoint demonstrates all four invariants: tenant scope, permission check,
  audit log, idempotency.
- CI green.
- No secrets committed.
- Migrations chain from 0001_baseline and are reversible.

# Architecture Overview

## Goal

Build a reliable, multi-tenant, offline-first POS SaaS using a modular monolith.

The system should be simple enough for a small team to operate, but robust enough to support paid beta tenants.

## Architecture Principles

- Modular monolith first.
- Shared database, shared schema.
- Multi-tenant from day one.
- Tenant isolation enforced in application logic and database layer.
- Offline-first for POS register flows.
- Secure by default.
- Decimal-only money handling.
- Spec-driven development.
- BDD for critical business behavior.
- No premature microservices.

## High-Level Components

```text
Frontend PWA
  React / TypeScript
  Dexie offline store
  TanStack Query
  Zustand
  i18n
  Register UI
  Admin UI
  Billing UI

Backend API
  FastAPI
  SQLAlchemy
  Pydantic
  Alembic
  Auth/session service
  RBAC/policy layer
  Domain services
  Audit log service
  Idempotency service
  Sync service
  Billing webhook service

Database
  PostgreSQL
  Shared schema
  tenant_id on domain tables
  RLS where applicable

External Services
  Stripe Billing / Checkout
  Email provider
  Sentry
  Object storage, if images are included
  Uptime monitoring
```

## Modular Monolith Domains

Suggested backend domain modules:

```text
app/
  auth/
  tenants/
  users/
  rbac/
  catalog/
  orders/
  payments/
  refunds/
  inventory/
  shifts/
  reports/
  billing/
  sync/
  audit/
  idempotency/
  settings/
  observability/
```

Each domain should prefer this structure:

```text
domain/
  models.py
  schemas.py
  repository.py
  service.py
  policies.py
  router.py
  tests/
```

Routers should be thin.

Business logic belongs in services.

Persistence belongs in repositories.

Authorization belongs in policies/dependencies.

## Multi-Tenancy

Use shared database + shared schema.

Every tenant-scoped table should include `tenant_id`.

Examples:

- products
- categories
- orders
- order_items
- payments
- refunds
- inventory_movements
- shifts
- reports/materialized data
- settings

Queries must be scoped by the authenticated tenant context.

PostgreSQL RLS should be used as defense in depth.

## Auth Model

Use:

- httpOnly secure cookies
- short-lived access token/session
- refresh token stored as hash in sessions table
- refresh rotation
- session revocation
- logout all sessions
- password reset
- email verification

Do not use localStorage for sensitive tokens.

## RBAC Model

Initial roles:

- owner
- manager
- cashier
- staff

Use permission constants, such as:

- catalog.create
- catalog.update
- catalog.delete
- orders.create
- orders.refund
- orders.void
- shifts.open
- shifts.close
- inventory.adjust
- reports.view_all
- users.manage
- billing.manage
- settings.manage

Every endpoint that mutates state must declare its required permission.

## Write Endpoint Invariants

Every important write endpoint should enforce:

1. Tenant scoping
2. Permission check
3. Idempotency where applicable
4. Audit log
5. Tests

Examples:

- Create order
- Refund order
- Void order
- Close shift
- Stock adjustment
- Billing webhook
- Catalog mutation

## Offline Sync Architecture

Frontend stores offline sales in Dexie.

States:

- pending
- syncing
- synced
- failed

Server sync must be idempotent.

Use:

- client_uuid
- Idempotency-Key
- batch sync endpoint
- retry with exponential backoff
- dead-letter UI for failed syncs

Failed sales must not disappear automatically.

User must have recovery actions.

## Money Handling

Use Decimal for all money logic.

Do not use floats.

Rules:

- Store currency on monetary records.
- Store amounts in Decimal or integer minor units.
- Be explicit about rounding.
- Add golden tests for:
  - cash change
  - split payments
  - refunds
  - shift reconciliation
  - discounts
  - taxes, when implemented

## Billing Architecture

Billing is subscription billing between the business and us.

Use one plan:

- Standard Plan
- $299 MXN/month
- all available features included

Use Stripe Billing / Stripe Checkout.

Store subscription state locally.

Use webhook idempotency.

Do not implement plan-based feature gates in v1.

## Observability

Every request should have:

- request_id
- tenant_id, if authenticated
- user_id, if authenticated

Use structured JSON logs.

Use Sentry or equivalent for backend/frontend errors.

Before beta, configure:

- alerting
- uptime monitor
- status page or basic status process
- backup restore drill

## Deployment

Recommended:

- Dockerized backend/frontend
- PostgreSQL managed provider
- Staging environment
- Production environment
- CI/CD
- Alembic migrations
- rollback procedure

Terraform preferred, but documented manual setup is acceptable for beta if it keeps execution moving.

## Testing Strategy

Use:

- pytest for backend unit/integration
- pytest-bdd for backend behavior where useful
- Playwright for frontend E2E
- Vitest for frontend unit tests
- Golden fixtures for money logic
- Cross-tenant tests for multi-tenancy
- Offline E2E tests for sync
- Migration tests

BDD is required for P0/P1 user-facing business behavior.

## Security Baseline

Before beta:

- strict CORS
- secure cookies
- CSRF strategy if using cookie auth
- rate limiting for auth/sync/upload endpoints
- no secrets in repo
- dependency vulnerability scan
- RLS tests
- permission tests
- audit logs
- backup restore drill

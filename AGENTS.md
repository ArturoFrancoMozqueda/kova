# AGENTS.md

## Purpose

This file defines the permanent product, engineering, architecture, quality, and delivery rules for this repository.

Codex must read this file before making any change.

This project is a new customizable multi-tenant POS SaaS platform inspired by the Sweet Home POS MVP learnings. It is not a refactor of the current MVP.

The goal is to build a sellable, reliable, offline-first, multi-tenant POS core that can safely be used by real businesses.

## Product Goal

Build the smallest reliable, multi-tenant, offline-first POS core that can be sold to real small businesses.

The first commercial milestone is a closed beta for bakery / small food retail businesses.

The north star flow is:

tenant signup → business setup → catalog setup → open shift → create sale → accept payment → issue receipt → offline sync if needed → close shift → review daily sales → maintain active subscription

Everything should protect or improve this flow.

Do not overbuild generic vertical functionality before the core flow is stable.

## Commercial Model

For v1 and closed beta, use one subscription plan only.

### Standard Plan

- Price: $299 MXN/month
- Includes all currently available features
- No Basic / Pro / Premium tiers
- No per-user pricing
- No per-location pricing
- No annual plan
- No usage-based billing
- No add-ons
- No feature-gated pricing tiers

Stripe Billing / Stripe Checkout should be used for subscription billing.

Feature flags are allowed only to hide unfinished/internal modules, not to create pricing tiers in v1.

## POS Payments vs Billing

Keep these concepts separate.

### Billing / Subscription Payments

The business pays us $299 MXN/month to use the POS.

### POS Payments

The business records or processes payments from its own customers.

Beta POS payment methods:

- Cash
- Bank transfer
- Manual card payment record
- Split payment if feasible

Stripe Terminal is not a beta blocker and should be deferred.

## Multi-Tenant Requirement

The product must be multi-tenant from day one.

A tenant represents one business account.

Every tenant must only see its own:

- Users
- Products
- Categories
- Sales
- Payments
- Refunds
- Customers
- Inventory
- Shifts
- Reports
- Settings
- Billing/subscription status

Every tenant-scoped table must include `tenant_id` unless there is a strong documented reason not to.

Every tenant-scoped query must be safely scoped.

Use both:

1. Application/service-layer tenant scoping
2. PostgreSQL Row-Level Security where applicable

Tenant isolation is a hard production requirement.

## Lessons Learned From the MVP

### Reuse

- Offline-first behavior is a strong POS differentiator.
- Dexie/service-worker-style sync is valuable.
- `client_uuid` / idempotency prevents duplicate sales.
- Split-payment should use a payment join table.
- Shift reconciliation is valuable and should be generalized.
- Inventory movements must be auditable.
- Stock decrement must be atomic.
- Pydantic-style validation is useful.
- Receipts, refunds, shifts, reporting, and inventory are core POS requirements.

### Do Not Repeat

- Single-tenant data model.
- Missing `tenant_id` on domain tables.
- Inline DDL/migrations in app startup.
- Zero automated tests.
- Scattered authorization checks.
- Employees seeing data they should not see.
- Hardcoded Spanish, MXN, Mexico City assumptions.
- Overly permissive CORS.
- Secrets committed to repo.
- JWT/localStorage auth without revocable sessions.
- No centralized permission model.
- No structured logs.
- No error tracking.
- No CI/CD gates.
- No audit log for important mutations.
- Weak offline retry/dead-letter behavior.

## Architecture Direction

Use a modular monolith.

Do not use microservices for v1.

Do not introduce Kafka, GraphQL, custom auth, or distributed complexity unless explicitly justified in an ADR.

### Frontend

Recommended baseline:

- React
- TypeScript
- Vite or Next.js, depending on repo direction
- PWA support
- Dexie for offline local storage
- TanStack Query for server state
- Zustand or similar for client/UI state
- Tailwind/shadcn-style component system
- i18n from the beginning

### Backend

Recommended baseline:

- FastAPI
- Python 3.12+
- SQLAlchemy 2
- Pydantic v2
- Alembic
- PostgreSQL

### Database

- PostgreSQL
- Shared database
- Shared schema
- `tenant_id` on every tenant-scoped domain table
- Row-Level Security as defense in depth
- UTC timestamps
- Tenant timezone for display/reporting
- Decimal money values
- No floats in money paths

### Auth

Use:

- httpOnly cookies
- Short-lived access session/token
- Refresh token/session table
- Revocable sessions
- Logout
- Logout all sessions
- Password reset
- Email verification

Do not store sensitive auth tokens in localStorage.

### Authorization

Use:

- Centralized RBAC/policy layer
- Permission constants
- Role-to-permission mapping
- Endpoint-level permission declaration
- Tests for permission boundaries

Do not scatter inline role checks inside route handlers.

### Observability

Use:

- Structured JSON logs
- `request_id`
- `tenant_id`
- `user_id`
- Sentry or equivalent
- Basic metrics
- Uptime monitoring before beta

### Deployment

Use:

- Dockerized services
- Staging environment
- CI/CD
- Alembic migrations
- Rollback plan
- Reproducible infrastructure

Terraform is preferred. For beta, documented manual setup is acceptable if Terraform blocks delivery.

## Scope Discipline

### Beta Includes

- Tenant signup
- Auth/session management
- Catalog
- Categories
- Products
- Variants if needed
- Register/cart
- Cash sale
- Bank transfer payment record
- Manual card payment record
- Receipt
- Offline sales queue
- Sync retry
- Dead-letter/recovery UI
- Refunds/voids
- Shifts
- Cash movements
- Basic inventory
- Basic reporting
- Standard Plan billing at $299 MXN/month
- Audit logs
- Observability
- Backups
- Basic support workflow

### Defer From Beta

- Multiple pricing tiers
- Multi-location
- KDS
- Tables/floor plan
- Appointments
- Loyalty
- Promotions
- Public API
- Webhooks
- Custom roles UI
- Stripe Terminal
- Hardware printer SDKs
- Advanced report builder
- Multi-currency
- White-label
- SSO
- Enterprise features

Restaurant is not production-ready until modifiers are stable.

## Specification-Driven Development

Do not implement features directly from vague tickets.

Every P0/P1 user-facing business feature must have:

1. Feature specification
2. Gherkin BDD scenarios
3. Test matrix
4. Acceptance criteria
5. Data model impact
6. API impact
7. Permissions impact
8. Offline impact, if applicable
9. Error states
10. Audit log behavior
11. Test coverage

BDD is required for user-facing P0/P1 business behavior.

BDD is not required for tiny helpers, internal utilities, repositories, or implementation details. Those can use unit/integration tests.

## Definition of Ready

A story is ready only when:

- Linked Feature Spec exists.
- Problem statement is clear.
- Target users are defined.
- Business value is defined.
- Functional requirements are written.
- Non-functional requirements are written.
- Gherkin scenarios exist for happy path and key edge cases.
- Permissions are defined.
- Tenant-scoping impact is defined.
- Idempotency impact is defined.
- Audit-log behavior is defined.
- Offline behavior is defined if applicable.
- Money/locale/rounding behavior is defined if applicable.
- Data model impact is documented.
- API impact is documented.
- UI states are documented.
- Error states and recovery actions are documented.
- Test matrix exists.
- Dependencies are clear.
- Story is sized.
- No unresolved product/design/engineering questions remain.

## Definition of Done

A story is done only when:

- Code is merged behind a feature flag if needed.
- All linked Gherkin scenarios pass.
- Unit/integration/e2e tests pass.
- Every new write endpoint has:
  - Tenant scoping
  - Permission check
  - Idempotency when applicable
  - Audit-log row
  - Automated tests
- Migrations are Alembic-managed.
- Migration rollback is documented or tested.
- Logs include `tenant_id`, `user_id`, and `request_id` where applicable.
- Sentry/error paths are reviewed.
- UI has loading/empty/error states.
- User-facing copy uses i18n.
- No secrets are committed.
- No critical/high dependency vulnerabilities.
- API docs are updated if applicable.
- Feature spec is updated to match final behavior.
- Demo acceptance is done against BDD scenarios.

## Hard Gates

These block beta/GA release:

- Tenant isolation tests
- Auth/session tests
- Write endpoint invariants
- Money golden tests
- Offline sync tests
- Migration tests
- No critical/high vulnerabilities
- Backup restore tested before beta
- No secrets in repo
- P0/P1 BDD scenarios passing

## Soft Gates

These should improve but may not block early beta unless severe:

- Help center completeness
- Marketing copy
- UI polish
- Advanced analytics events
- Non-critical accessibility improvements
- Lighthouse score targets

## Non-Negotiable Technical Invariants

- `tenant_id` everywhere it belongs
- RLS for tenant-scoped tables
- Centralized permission checks
- Audit log for every important mutation
- Idempotency for important writes
- Decimal for money
- No floats in money logic
- UTC storage for timestamps
- Tenant timezone for display/reporting
- i18n for user-facing strings
- Alembic migrations only
- No inline DDL in app startup
- Secrets manager / env secrets only
- No committed secrets
- Structured logs
- Sentry/error tracking
- Tests for money/offline/authz flows

## PR Requirements

Every PR must include:

- Linked spec
- Linked BDD scenarios
- Linked test matrix
- Tenant isolation impact
- Permission impact
- Idempotency impact
- Audit-log impact
- Offline impact if applicable
- Money/rounding impact if applicable
- Migration notes
- Observability notes
- Tests added/updated
- UI states covered
- Rollback plan if applicable

Reject PRs that:

- Add tenant-scoped data without `tenant_id`
- Add write endpoint without permission check
- Add write endpoint without audit log
- Add money logic using floats
- Add user-facing copy outside i18n
- Add endpoint without tests
- Bypass service/policy layer
- Add secrets to repo
- Introduce cross-tenant data risk

## Required Documentation Structure

```text
AGENTS.md
docs/
  sprint-planning.md
  current-sprint.md
  deferred-scope.md
  risk-register.md
  architecture.md
  adr/
specs/
  auth/
  billing/
  catalog/
  inventory/
  orders/
  reports/
  settings/
  shifts/
  shared/
```

## Working Mode for Codex

When implementing:

1. Read `AGENTS.md`.
2. Read `docs/current-sprint.md`.
3. Read `docs/sprint-planning.md`.
4. Identify the current sprint/story.
5. Check whether the Feature Spec exists.
6. If no Feature Spec exists, create/request one before implementation.
7. Do not write code before spec/BDD/test matrix is clear.
8. Keep changes scoped to current story.
9. Do not introduce deferred features unless explicitly requested.
10. Preserve all technical invariants.
11. Prefer small, reviewable PR-sized changes.

## Final Reminder

The goal is not to build the most complete POS in the market.

The goal is to build the smallest reliable, multi-tenant, offline-first POS core that can safely be used and paid for by real businesses.

Keep the core boring, stable, secure, and well-tested.

Expand verticals only after the core survives real beta usage.

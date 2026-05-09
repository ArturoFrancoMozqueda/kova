# Current Sprint

## Active Sprint

Sprint: 0C - Quality + BDD Foundation

## Sprint Goal

Lock in the spec-driven delivery system before implementing core POS product features.

## Allowed Work

Only work on:

- Structured JSON logging with `request_id`, `tenant_id`, and `user_id` fields
- Backend BDD tooling and the first auth happy-path feature file
- Frontend Playwright E2E scaffold and app-shell smoke test
- PR template enforcing spec, BDD, and test-matrix links
- Sentry placeholders for backend and frontend, no-op when DSNs are unset
- Pre-commit hooks for ruff and no-secrets scanning
- OpenAPI export in CI
- `docs/test-matrixes` structure and reusable test matrix template
- CI quality gates for the above

## Explicitly Not Allowed This Sprint

Do not implement:

- Catalog
- Register / cart
- Orders / payments
- Billing / Stripe
- Offline sync
- Refunds / shifts / inventory / reporting
- Multi-location
- Deferred scope from `docs/deferred-scope.md`

## Required Specs

- `specs/auth/happy_path.feature`
- `docs/test-matrixes/template.md`

## Required BDD / Test Scenarios

- Tenant owner signs up, verifies email, logs in, and sees tenant-scoped session data.
- Frontend app shell loads in Playwright.
- Logs include `request_id`, `tenant_id`, and `user_id` fields.

## Sprint 0C Tasks

### Backend Quality

- [x] Add structured JSON logging.
- [x] Add request ID middleware and `x-request-id` response header.
- [x] Include stable `request_id`, `tenant_id`, and `user_id` log fields.
- [x] Add backend Sentry initialization placeholder.
- [x] Add OpenAPI export script.

### BDD

- [x] Add pytest-bdd dependency.
- [x] Add backend BDD runner.
- [x] Add first auth happy-path feature file.
- [x] Add passing step definitions.

### Frontend Quality

- [x] Add frontend Sentry initialization placeholder.
- [x] Add Playwright scaffold.
- [x] Add app-shell smoke test.
- [x] Add no raw `console.log` lint rule.

### Delivery System

- [x] Add PR template.
- [x] Add `docs/test-matrixes` structure.
- [x] Add test matrix template.
- [x] Add pre-commit hooks.
- [x] Add CI quality gates for BDD, E2E, OpenAPI export, and no-secrets scan.

## Definition of Done

- Backend BDD works.
- Frontend E2E works.
- PR template exists.
- Test matrix template exists.
- CI runs quality gates.
- Logs include `request_id`.
- Sentry initializes only when configured.

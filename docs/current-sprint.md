# Current Sprint

## Active Sprint

Sprint: 1 - Catalog Foundation

## Sprint Goal

Allow a tenant owner to create the basic catalog needed to sell, without introducing deferred restaurant, modifier, or multi-location complexity.

## Required Specs

- `specs/catalog/categories.md`
- `specs/catalog/products.md`
- `specs/catalog/variants.md`

## Required BDD / Test Scenarios

- Tenant owner creates and lists a category and product.
- Cashier cannot create catalog products.
- Tenants cannot see each other's catalog products.

## Allowed Work

Only work on:

- Category data model, migration, repository, service, schemas, router, and tests
- Product data model, migration, repository, service, schemas, router, and tests
- Catalog permission checks using existing RBAC constants
- Catalog idempotency for write endpoints
- Catalog audit logs for important mutations
- Catalog tenant isolation tests
- Basic backend BDD for catalog foundation

## Explicitly Not Allowed This Sprint

Do not implement:

- Register / cart
- Orders / payments
- Billing / Stripe
- Offline sync
- Refunds / shifts / inventory / reporting
- Multi-location
- Product modifiers
- Restaurant-specific behavior
- Variant tables unless explicitly justified by beta setup needs
- Deferred scope from `docs/deferred-scope.md`

## Sprint 1 Tasks

### Backend

- [x] Create `categories` table.
- [x] Create `products` table.
- [x] Add RLS policies.
- [x] Add catalog models.
- [x] Add catalog schemas.
- [x] Add catalog repository.
- [x] Add catalog service.
- [x] Add catalog router.
- [x] Add category create/list/update/deactivate endpoints.
- [x] Add product create/list/update/deactivate endpoints.
- [x] Add audit logging for writes.
- [x] Add idempotency for writes.

### Tests

- [x] Add catalog BDD scenarios.
- [x] Add owner happy-path tests.
- [x] Add tenant isolation tests.
- [x] Add permission denied tests.
- [x] Add idempotency replay tests.
- [x] Add decimal money tests.

## Definition of Done

- Linked specs exist.
- Linked BDD scenarios pass.
- Test matrix exists.
- Category and product write endpoints have tenant scoping, permission checks, idempotency, audit logs, and tests.
- Migrations are Alembic-managed and reversible.
- API docs include catalog endpoints.
- Unit/integration/e2e quality gates pass.

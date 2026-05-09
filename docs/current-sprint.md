# Current Sprint

## Active Sprint

Sprint: 7 - Inventory Basics

## Sprint Goal

Allow owners and managers to see stock on hand, correct inventory with manual adjustments, reconcile physical counts through stock takes, and spot low-stock products.

## Required Specs

- `specs/inventory/stock_take.md`
- `specs/inventory/adjustment.md`
- `specs/inventory/low_stock.md`

## Required BDD / Test Scenarios

- Manager manually adjusts stock and the stock view updates.
- Manager performs a stock take and the delta is calculated correctly.
- Low-stock threshold flags products at or below threshold.
- Cashier without `inventory.adjust` cannot adjust stock.
- Tenant B cannot see Tenant A's stock.

## Allowed Work

Only work on:

- Inventory stock view API and UI
- Manual adjustment endpoint and modal
- Stock take endpoint and modal
- Low-stock threshold endpoint and low-stock view
- Inventory movement metadata needed for adjustments and stock takes
- Permission gate for `inventory.adjust`
- Audit logging for inventory adjustments, stock takes, and threshold updates
- Idempotency for inventory write endpoints
- Backend and frontend tests
- General app shell UI polish that supports inventory navigation

## Explicitly Not Allowed This Sprint

Do not implement:

- Purchase orders
- Supplier management
- Multi-location inventory
- Expiration or lot tracking
- Barcode scanner workflows
- Forecasting or advanced replenishment
- Inventory valuation/accounting
- Offline inventory adjustment
- Deferred scope from `docs/deferred-scope.md`

## Sprint 7 Tasks

### Backend

- [x] Add stock view endpoint.
- [x] Add stock take endpoint.
- [x] Add manual adjustment endpoint.
- [x] Add low-stock threshold field.
- [x] Add low-stock endpoint.
- [x] Add inventory audit logging.
- [x] Add idempotency support for inventory write endpoints.
- [x] Add permission checks for `inventory.adjust`.
- [x] Add tenant scoping for all inventory queries.

### Frontend

- [x] Add inventory page.
- [x] Add stock view.
- [x] Add stock adjustment modal.
- [x] Add stock take modal.
- [x] Add low-stock dashboard widget.
- [x] Add loading/error states.
- [x] Add permission-based UI gating.
- [x] Improve app shell UI/navigation.

### Tests

- [x] Add inventory BDD scenarios.
- [x] Add backend inventory integration coverage.
- [x] Add frontend inventory UI E2E tests.

## Definition of Done

- Linked specs exist and are up-to-date.
- Linked BDD scenarios pass.
- Test matrix exists.
- Inventory write endpoints have tenant scoping, permission checks, idempotency, audit logs, and tests.
- Stock on hand is computed from inventory movements.
- Stock take delta is correct.
- Low-stock products are returned correctly.
- Inventory UI has loading/error/empty states and permission gating.
- Quality gates pass.

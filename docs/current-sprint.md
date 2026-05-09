# Current Sprint

## Active Sprint

Sprint: 8 - Reporting v1

## Sprint Goal

Give owners and managers a basic, tenant-scoped view of sales performance: range summary, payment method totals, and top products.

## Required Specs

- `specs/reports/range.md`
- `specs/reports/payment_breakdown.md`
- `specs/reports/top_products.md`

## Required BDD / Test Scenarios

- Manager views a sales range summary.
- Manager views payment method totals.
- Manager views top products.
- Cashier without `reports.view_all` cannot view reports.
- Tenant B cannot see Tenant A's reports.

## Allowed Work

Only work on:

- Sales summary report endpoint and UI
- Payment breakdown endpoint and UI
- Top products endpoint and UI
- Date range filters
- Tenant-scoped reporting queries
- Permission gate for `reports.view_all`
- Backend and frontend tests
- Basic report UI loading/error/empty states

## Explicitly Not Allowed This Sprint

Do not implement:

- Advanced report builder
- CSV/export workflows unless needed later
- Tax reports
- Inventory valuation
- Multi-location reporting
- Employee commission reporting
- Forecasting
- Offline report generation
- Deferred scope from `docs/deferred-scope.md`

## Sprint 8 Tasks

### Backend

- [x] Add sales summary endpoint.
- [x] Add payment breakdown endpoint.
- [x] Add top products endpoint.
- [x] Add date range filtering.
- [x] Exclude voided orders from sales reports.
- [x] Include refunds in net sales calculation.
- [x] Add permission checks for `reports.view_all`.
- [x] Add tenant scoping for all report queries.

### Frontend

- [x] Add reports page.
- [x] Add date range controls.
- [x] Add sales summary cards.
- [x] Add payment breakdown list.
- [x] Add top products list.
- [x] Add loading/error/empty states.
- [x] Add permission-based UI gating.

### Tests

- [x] Add reports BDD scenarios.
- [x] Add backend report integration coverage.
- [x] Add frontend report UI E2E tests.

## Definition of Done

- Linked specs exist and are up-to-date.
- Linked BDD scenarios pass.
- Test matrix exists.
- Report endpoints are tenant-scoped and permission-gated.
- Gross sales, refunds, net sales, payment breakdown, and top products are calculated with Decimal values.
- Voided orders are excluded.
- Reports UI has loading/error/empty states and permission gating.
- Quality gates pass.

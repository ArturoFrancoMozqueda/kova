# Top Products Report Spec

## Problem

Owners need a quick view of best-selling products.

## Target Users

- Tenant owner
- Manager

## Business Value

Top products help beta tenants prepare production and stocking decisions.

## Functional Requirements

- A user with `reports.view_all` can request top products for a date range.
- Voided orders are excluded.
- Each row includes product id, product name, quantity sold, and gross sales.
- Results are sorted by quantity sold descending, then gross sales descending.

## Non-Functional Requirements

- Queries are tenant-scoped.
- Money calculations use Decimal.

## Permissions

- Requires `reports.view_all`.

## Idempotency

- Read-only endpoint; not applicable.

## Audit Log Behavior

- Read-only endpoint; no audit log.

## Offline Impact

- Online only in Sprint 8.

## Error States

- End date before start date returns 400.
- Invalid limit returns validation error.

## Acceptance Criteria

- Completed order items are aggregated by product.
- Tenant B cannot see Tenant A's products.

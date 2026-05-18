# Sales Range Report Spec

## Problem

Owners need to see sales performance for a selected date range.

## Target Users

- Tenant owner
- Manager

## Business Value

Basic range reporting helps beta tenants understand daily sales and catch operational anomalies.

## Functional Requirements

- A user with `reports.view_all` can request a sales summary for a date range.
- Summary includes gross sales, refund total, net sales, order count, refund count, and void count.
- Voided orders are excluded from gross and net sales.
- Refund totals reduce net sales.
- If no dates are provided, the endpoint defaults to the current UTC day.
- A user with `reports.view_all` can request hourly sales with `GET /api/v1/reports/sales-by-hour?start=&end=`.
- Hourly sales returns 24 rows, one for each hour `0..23`, with `net_sales` and `order_count`.
- Hourly sales uses only completed orders for the authenticated tenant and selected UTC date range.
- Refunds linked to completed orders reduce the `net_sales` for the order hour.
- A user with `reports.view_all` can request employee sales with `GET /api/v1/reports/sales-by-employee?start=&end=`.
- Employee sales is grouped by `orders.created_by_user_id` for the authenticated tenant and selected UTC date range.
- Employee sales returns `user_id`, `display_name`, `order_count`, `net_sales`, and `refund_count`.
- Employee performance copy must be coaching-oriented and not punitive.
- A user with `reports.view_all` can request refund reasons with `GET /api/v1/reports/refunds-by-reason?start=&end=` because `refunds.reason` exists in the schema.
- Refund reason rows include reason, refund count, and refunded amount.

## Non-Functional Requirements

- Queries are tenant-scoped.
- Money calculations use Decimal.
- Timestamps are stored in UTC and range filters are interpreted as UTC dates for Sprint 8.

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
- Missing permission returns 403.

## Acceptance Criteria

- Completed orders contribute to gross sales.
- Refunds reduce net sales.
- Voided orders are excluded.
- Hourly sales returns stable 24-hour buckets and never invents traffic.
- Employee sales is hidden from roles without `reports.view_all`.
- Refund reasons aggregate only tenant-scoped refund rows.

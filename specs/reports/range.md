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
- Refund count counts refund events, including multiple partial refunds on the
  same order; it does not count distinct refunded orders. Dashboard health shows
  refund events per 100 completed orders, which can exceed 100, rather than
  claiming a percentage of orders affected. The underlying report fields and
  health score calculation remain unchanged.
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
- A user with `reports.view_all` can request the business storytelling report with `GET /api/v1/reports/business-story?start=&end=`.
- The business storytelling report returns one consolidated payload for the selected period:
  - summary metrics: net sales, completed orders, average ticket, refunds, and cancellations
  - sales by day with net sales, completed orders, average ticket, and share of period sales
  - sales by daypart using human time blocks: madrugada `00:00-05:59`, mañana `06:00-11:59`, tarde `12:00-17:59`, noche `18:00-23:59`
  - peak hour as secondary drill-down, not the main insight
  - top product by sales, top product by units, and top product sales share
  - dominant payment method and payment share
  - operational signals for refunds and cancellations
  - recommended actions based only on real rows in the selected period
- Business storytelling copy may be assembled by the client, but all complex aggregations must come from the backend payload.
- If no completed sales exist, the business storytelling report returns empty rows and empty-state guidance instead of demo data.
- Product share is based on completed order item gross sales until refund attribution at item level is modeled.
- Inventory-aware stock recommendations are deferred unless inventory data is explicitly joined into a future report payload.

## Non-Functional Requirements

- Queries are tenant-scoped.
- Money calculations use Decimal.
- Timestamps are stored in UTC.
- Business storytelling date, day, daypart, and hour buckets use the tenant business profile timezone when configured and default to `America/Mexico_City`.
- Frontend report presets and related product story date ranges must derive `today`,
  `yesterday`, current month, and relative ranges from the tenant/default timezone, not
  `Date.toISOString()` UTC slices. In Mexico City, after 18:00 local time, "Hoy" must still
  request the local business date.

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
- Sales by day answers which days sold more without forcing a low-day conclusion when there is not enough data.
- Sales by daypart is the primary time-of-day insight and hourly sales remains drill-down detail.
- Recommended actions have a type of `opportunity`, `risk`, `good_signal`, or `operational_improvement`.
- Recommended actions are specific to the period data and are omitted when no supporting data exists.
- The Reports "Hoy" preset and ProductStoryCard 30-day ranges do not jump to tomorrow when UTC
  has advanced but the tenant's local business day has not.

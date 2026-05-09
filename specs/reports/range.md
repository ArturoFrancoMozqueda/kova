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

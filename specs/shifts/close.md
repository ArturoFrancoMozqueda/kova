# Close Shift Spec (Sprint 6)

## Problem Statement

A cashier or manager needs to end a shift by recording the final cash count, reconciling expected vs actual cash, and generating a shift reconciliation report. Close shift is a multi-step wizard that prevents data loss and ensures accurate cash handling.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Shift closure captures the actual cash in the register, reconciles it against system expectations, and creates an audit trail for daily accounting. This is critical for detecting discrepancies and holding cashiers accountable.

## Functional Requirements

- Authenticated users with `shifts.close` can close an open shift in their tenant.
- Shift close is a wizard with steps: confirm final cash count, review reconciliation, confirm closure.
- Close shift records: closing time, closing user, actual cash counted, reconciliation status.
- System calculates expected cash: opening balance + sum of cash payments - sum of refunded cash - sum of cash removals.
- Reconciliation status is: `balanced` if actual == expected, `overage` if actual > expected, `shortage` if actual < expected.
- The difference amount is recorded.
- Closing a shift does not delete any sales or movements — only adds closure metadata.
- A closed shift cannot be reopened.
- A shift can only be closed once all sales are finalized (no pending/syncing orders).

## Non-Functional Requirements

- Store money as database decimal/numeric values.
- Do not use floats in reconciliation calculations.
- Store timestamps in UTC.
- Every shift includes `tenant_id`.
- Reconciliation data is immutable once closed.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Shift closure requires `shifts.close`.

## Idempotency

- `POST /api/v1/shifts/{shift_id}/close` requires `Idempotency-Key`.
- Replaying the same request with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Successful shift close writes `shifts.close` with reconciliation status and variance amount.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Missing `Idempotency-Key` returns `400`.
- No shift open returns `400`.
- Shift already closed returns `400`.
- Actual cash is negative returns `400`.

## Data Model Impact

- Update `shifts` table: add `closed_at`, `closing_user_id`, `actual_cash_amount`, `expected_cash_amount`, `reconciliation_status` (`balanced|overage|shortage`), `variance_amount`.

## API Impact

- `POST /api/v1/shifts/{shift_id}/close` — close a shift (requires `actual_cash_amount`)
- `GET /api/v1/shifts/{shift_id}` — get shift details including reconciliation
- `GET /api/v1/shifts/closed` — list closed shifts for reporting

## Acceptance Criteria

- A cashier can close an open shift by providing actual cash count.
- System calculates expected cash correctly.
- Reconciliation status (`balanced`, `overage`, `shortage`) is determined correctly.
- Variance amount is recorded.
- Tenant B cannot close Tenant A's shifts.
- Duplicate close request with same key returns same response.
- Shift status updates to `closed`.

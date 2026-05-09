# Cash Movements Spec (Sprint 6)

## Problem Statement

During a shift, cash can enter or leave the register for reasons beyond sales: opening balance, manager removals, tips payout, donations, etc. Cash movements track all non-sale cash adjustments for audit and reconciliation accuracy.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Cash movements create a complete audit trail of all cash in/out events, enabling accurate reconciliation, fraud detection, and compliance with financial controls.

## Functional Requirements

- Only managers and owners with `shifts.open` (or similar) can create cash movements.
- Cash movements are tied to an open shift.
- Movement types: `opening_balance`, `cash_in` (customer deposit), `cash_out` (removal), `cash_refund` (from refunded sale).
- Each movement records: shift ID, type, amount, reason/reference, created by user, created at.
- Cash movements are immutable (no edits after creation).
- All cash movements in a shift contribute to the expected cash calculation at close.
- Negative amounts are not allowed (use movement type to indicate direction).

## Non-Functional Requirements

- Store money as database decimal/numeric values.
- Do not use floats in money paths.
- Store timestamps in UTC.
- Every movement includes `tenant_id` and `shift_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Creating cash movements requires `shifts.open` or manager role.
- Any user can view their shift's cash movements.

## Audit Log Behavior

- Each cash movement creation writes `shifts.cash_movement` with type, amount, reason.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- No open shift returns `400`.
- Negative amount returns `400`.
- Invalid movement type returns `400`.
- Missing reason/reference returns `400`.

## Data Model Impact

- Add `cash_movements` table: `id`, `shift_id`, `tenant_id`, `type` (enum/string), `amount`, `reason`, `created_by_user_id`, `created_at`.

## API Impact

- `POST /api/v1/shifts/{shift_id}/cash-movements` — record a cash movement
- `GET /api/v1/shifts/{shift_id}/cash-movements` — list movements for a shift

## Acceptance Criteria

- A manager can record cash in/out during an open shift.
- Cash movements are recorded with type, amount, and reason.
- Opening balance movement is created when shift is opened with opening cash.
- Tenant B cannot create movements in Tenant A's shift.
- Cash movements appear in shift reconciliation calculations.
- Closed shifts prevent new cash movements.

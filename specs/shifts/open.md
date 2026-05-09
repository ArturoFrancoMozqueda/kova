# Open Shift Spec (Sprint 6)

## Problem Statement

A cashier needs to begin work by opening a shift, which records the start time and optionally the initial cash amount in the register. Shifts are the time-bounded container for all sales and cash movements during a work period.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Shifts enable per-cashier accountability, cash reconciliation, and accurate daily reporting. Opening a shift is the first action in the north star flow before any sales can occur.

## Functional Requirements

- Authenticated users with `shifts.open` can open a shift for their tenant.
- Only one shift can be open per tenant at a time (prevents multiple concurrent shifts).
- A shift captures: start time, opening cashier, optional opening cash amount, status (`open`, `closed`).
- If opening cash is provided, it creates a cash movement record of type `opening_balance`.
- A shift can only be closed by the same tenant or a manager of that tenant.
- Opening a shift returns the shift details including shift ID and opening time.

## Non-Functional Requirements

- Store money as database decimal/numeric values.
- Do not use floats in money paths.
- Store timestamps in UTC.
- Every shift includes `tenant_id`.
- Every cash movement includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Shift opening requires `shifts.open`.
- Any authenticated user can view their own tenant's shift status.

## Idempotency

- `POST /api/v1/shifts` requires `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Successful shift open writes `shifts.open` with opening cash amount (if provided).

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Missing `Idempotency-Key` returns `400`.
- Shift already open returns `400`.
- Opening cash is negative returns `400`.

## Data Model Impact

- Add `shifts` table: `id`, `tenant_id`, `opened_by_user_id`, `opened_at`, `closed_at` (nullable), `status`, `opening_cash_amount` (nullable).
- `cash_movements` table for recording opening balance and other cash in/out events.

## API Impact

- `POST /api/v1/shifts` — open a shift (optional `opening_cash_amount`)
- `GET /api/v1/shifts/current` — get the currently open shift (if any)

## Acceptance Criteria

- A cashier can open a shift.
- The shift is recorded with start time and opening cashier ID.
- If opening cash is provided, it creates a cash movement record.
- Tenant B cannot see or affect Tenant A's shifts.
- Duplicate open request with same key returns same response.
- Only one shift can be open per tenant.

# Current Sprint

## Active Sprint

Sprint: 6 - Shifts + Cash Movements

## Sprint Goal

Reproduce and generalize the MVP's shift reconciliation. Cashiers can open/close shifts with cash reconciliation, managers can record cash in/out movements, and the system calculates expected vs actual cash variance.

## Required Specs

- `specs/shifts/open.md`
- `specs/shifts/close.md`
- `specs/shifts/cash_movements.md`

## Required BDD / Test Scenarios

- Cashier opens a shift with opening cash and recording is successful.
- Cashier opens a shift without opening cash.
- Cannot open a shift if one is already open.
- Cashier closes a shift with balanced cash reconciliation.
- Cashier closes a shift with overage or shortage detected.
- Cannot close a shift that is already closed.
- Manager records cash in/out movements during a shift.
- Cash movements affect shift reconciliation calculations.
- Cannot record negative amounts.
- Duplicate open/close requests with same key return same response.
- Tenant B cannot see/manage Tenant A's shifts.

## Allowed Work

Only work on:

- Shift open/close APIs and service
- Cash movement recording and tracking
- Shift reconciliation calculation (expected vs actual cash)
- Opening balance cash movement creation
- Permission gates for `shifts.open` and `shifts.close`
- Audit logging for shift open, close, and cash movements
- Idempotency for shift and cash movement endpoints
- Shift history/retrieval endpoints
- Backend and frontend tests
- Shift UI: open shift form, active shift card, close shift wizard
- Shift reconciliation display and variance reporting

## Explicitly Not Allowed This Sprint

Do not implement:

- Multiple concurrent shifts per tenant (one open at a time)
- Shift reassignment or modification after close
- Till reconciliation beyond cash count
- Hardware drawer integration
- Tip pooling or payouts
- Multi-location shifts
- Advanced analytics beyond reconciliation
- Deferred scope from `docs/deferred-scope.md`

## Sprint 6 Tasks

### Backend

- [ ] Add `shifts` table with `id`, `tenant_id`, `opened_by_user_id`, `closed_by_user_id`, `opened_at`, `closed_at`, `status`, `opening_cash_amount`, `actual_cash_amount`, `expected_cash_amount`, `reconciliation_status`, `variance_amount`.
- [ ] Add `cash_movements` table with `id`, `shift_id`, `tenant_id`, `type` (enum), `amount`, `reason`, `created_by_user_id`, `created_at`.
- [ ] Add shift service with open, close, get, and list operations.
- [ ] Add shift calculator for expected cash computation and reconciliation.
- [ ] Add `POST /api/v1/shifts` endpoint to open shift (with optional opening cash).
- [ ] Add `GET /api/v1/shifts/current` endpoint to get open shift.
- [ ] Add `POST /api/v1/shifts/{shift_id}/close` endpoint to close shift.
- [ ] Add `GET /api/v1/shifts/{shift_id}` endpoint to get shift details with reconciliation.
- [ ] Add `POST /api/v1/shifts/{shift_id}/cash-movements` endpoint to record movement.
- [ ] Add `GET /api/v1/shifts/{shift_id}/cash-movements` endpoint to list movements.
- [ ] Add `GET /api/v1/shifts/closed` endpoint to list closed shifts.
- [ ] Validate shift states: prevent double open, prevent close of non-open shift.
- [ ] Implement opening balance cash movement creation on shift open.
- [ ] Implement expected cash calculation (opening + payments - refunds - removals).
- [ ] Implement reconciliation status determination (balanced|overage|shortage).
- [ ] Implement variance amount calculation.
- [ ] Add RLS policies for shifts and cash_movements tables.
- [ ] Add permission checks: `shifts.open`, `shifts.close`.
- [ ] Add audit logging for shift open, close, and cash movements.
- [ ] Add idempotency support for shift open and close endpoints.
- [ ] Prevent multiple concurrent open shifts per tenant.

### Frontend

- [ ] Add shift state to app (current open shift display).
- [ ] Add open shift form/modal: optional opening cash input.
- [ ] Add active shift card: displays shift info, allows cash in/out entry.
- [ ] Add cash in/out recording UI: amount, reason, movement type.
- [ ] Add close shift wizard: 3 steps (confirm count, review reconciliation, confirm closure).
- [ ] Add reconciliation display: expected vs actual, variance, status (balanced/overage/shortage).
- [ ] Add shift history view: list closed shifts with reconciliation details.
- [ ] Add loading/error states for shift operations.
- [ ] Add permission-based UI gating (only show if user has shifts.open/close).
- [ ] Add success/error notifications for shift operations.
- [ ] Add disabled state for forms during async operations.

### Tests

- [ ] Add open shift BDD scenarios (with/without opening cash, cannot double-open, idempotency, permissions, tenant isolation).
- [ ] Add close shift BDD scenarios (balanced/overage/shortage, cannot double-close, idempotency, permissions, tenant isolation).
- [ ] Add cash movement BDD scenarios (valid recording, negative amounts rejected, permissions, tenant isolation).
- [ ] Add shift reconciliation golden tests (expected cash calculation, variance computation).
- [ ] Add concurrent shift prevention test.
- [ ] Add backend shift integration tests.
- [ ] Add frontend shift UI E2E tests (open, record movements, close).

## Definition of Done

- Linked specs exist and are up-to-date.
- Linked BDD scenarios pass.
- Test matrix exists.
- Shift open endpoint has tenant scoping, permission check, opening balance movement, audit, idempotency, and tests.
- Shift close endpoint has reconciliation calculation, variance computation, audit, idempotency, and tests.
- Cash movement endpoint has validation, audit, tenant scoping, and tests.
- Expected cash calculation is correct (opening + sales - refunds - removals).
- Reconciliation status correctly determined (balanced|overage|shortage).
- Cannot open multiple shifts per tenant concurrently.
- All money calculations use Decimal.
- Shift UI is complete and gated by permission.
- Quality gates pass.

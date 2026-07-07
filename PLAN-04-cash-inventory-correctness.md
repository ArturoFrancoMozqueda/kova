# PLAN-04 — Cash & Inventory Correctness

## Priority and rationale

**Rank 4.** These are money- and inventory-integrity defects that silently corrupt the numbers a POS exists to keep honest. They are individually small but collectively erode trust in reports and the cash drawer:

- **D4 — refund method not validated vs payments (P1 money):** a bank-transfer-only order can be refunded `method="cash"`, generating a cash `refund_payout` that drains the physical drawer for money that was never in it.
- **D5 — negative stock via manual adjustment (P1):** `adjust_stock` has no floor; on-hand can go negative and corrupt reports/reorder logic.
- **D7 — no single-open-shift guarantee (P2 race):** two concurrent opens create two drawers; cash attributes ambiguously.
- **D6 — payment mix not refund-adjusted (P2):** `Σ payment_mix ≠ net_sales` on refund days; an auditor's totals won't tie.

High leverage relative to effort: contained, testable backend changes with clear correctness criteria.

## Goal

- A refund's payment method and amount cannot exceed what was actually collected in that method for the order; the drawer can never be over-drained.
- Manual inventory adjustments cannot drive on-hand negative unless an explicit, audited "shrinkage/loss" intent is provided (product decision — default: block).
- At most one shift can be open per tenant, enforced at the database level.
- Payment-mix reporting is internally consistent with `net_sales` (either refund-adjusted or clearly labeled as gross-collected with the delta shown).

## Current behavior (repository evidence)

- **Refund method (D4):** `refund_payment_method` is a free client choice (`orders/schemas.py:156`), never checked against the order's payments. Cash refunds require an open shift and post a `refund_payout` (`orders/service.py:449-453, 502-511`) but no per-method paid-amount ceiling. Defaulting `refund_payment_method=None` skips the cash movement and shift requirement even for a cash order.
- **Negative stock (D5):** `InventoryAdjustmentCreate.quantity_delta` is an unbounded `int` (only `!= 0`, `inventory/schemas.py:29-38`); `adjust_stock` (`inventory/service.py:159-212`) applies the delta with no floor. `stock_take` uses `counted_quantity >= 0` but the resulting delta is unbounded. The `OUT_OF_STOCK` guard exists only on the sale path.
- **Single open shift (D7):** `Shift` has no unique/partial constraint (`shifts/models.py:15-39`; migration `0010_shifts.py` only indexes `tenant_id`); `get_open_shift` (`shifts/repository.py:10-15`) uses no lock and returns `.first()`. Two concurrent `POST /shifts` can both pass the `existing_open` check.
- **Payment mix (D6):** `payment_breakdown` / `_payment_drivers` (`reports/service.py:178-209, 743-767`) sum raw `Payment.amount_amount`, never reduced by refunds (cash refunds are `refund_payout` movements, not negative payments).

## Problems identified

1. D4: refund method/amount unvalidated → drawer over-drain / phantom cash refunds.
2. D5: manual adjustment → negative on-hand.
3. D7: no DB-level single-open-shift invariant → ambiguous corte de caja.
4. D6: payment-mix inconsistent with net sales.

## Scope

**Included:** `backend/app/orders/{schemas,service,repository}.py` (refund validation), `backend/app/inventory/{schemas,service}.py` (stock floor), `backend/app/shifts/{repository,service}.py` + a migration (single-open-shift), `backend/app/reports/service.py` (payment-mix), tests. **Excluded:** the offline/billing/RLS work; a full tax engine (separate product decision).

## Exact files to modify / create

- **`backend/app/orders/service.py`** (`create_refund` ~`:383-511`) — before creating a refund, compute per-method collected totals for the order (sum of `payments` by method, minus prior refunds by method) and reject a refund whose method/amount exceeds the collected-and-not-yet-refunded amount for that method. Require an explicit `refund_payment_method` for any refund (no silent `None` on a paid order).
- **`backend/app/orders/repository.py`** — add a helper to sum collected payments and prior refunds per method for an order (tenant-scoped).
- **`backend/app/orders/schemas.py`** — make `refund_payment_method` required (or validated) for refunds.
- **`backend/app/inventory/service.py`** (`adjust_stock` ~`:159-212`) — under the existing product row lock, compute resulting on-hand and reject if it would go negative, unless the request carries an explicit `allow_negative`/`reason="shrinkage"` intent (product decision; default block). `stock_take` already floors counts but ensure the derived delta cannot be applied against a stale read (it's under the lock).
- **`backend/app/inventory/schemas.py`** — optional `reason`/intent field if allowing audited negative adjustments.
- **`backend/alembic/versions/00XX_single_open_shift.py`** (new) — partial unique index: `CREATE UNIQUE INDEX uq_one_open_shift_per_tenant ON shifts (tenant_id) WHERE status = 'open'`. Reversible downgrade.
- **`backend/app/shifts/repository.py` / `service.py`** — on open, rely on the partial unique index (catch `IntegrityError` → 409 "ya hay un turno abierto"); optionally take a tenant-scoped advisory lock to serialize the check.
- **`backend/app/reports/service.py`** — refund-adjust `payment_breakdown`/`payment_mix`, or add an explicit "refunds" line so the mix reconciles to `net_sales`; document the definition.

New files: the two migrations; `backend/app/tests/test_refund_method_validation.py`, additions to `test_cash_reconciliation.py`, `test_orders.py`, `test_shifts_open.py`, `test_reports_*`.

## Dependencies

- Runs on the current schema; two additive migrations.
- Independent of PLAN-01/02/03 (can proceed in parallel).

## Step-by-step implementation order

1. **Refund method/amount validation (`orders/service.py`, `repository.py`, `schemas.py`).**
   - Behavior: reject a refund whose per-method amount exceeds collected-minus-already-refunded for that method; require an explicit method.
   - Data model: none. API: `refund_payment_method` becomes required/validated (contract tightening — see backward-compat). Security: prevents drawer manipulation. Backward-compat: clients already send a method in the UI; document the stricter validation; return a clear 422 code (e.g. `REFUND_METHOD_EXCEEDS_COLLECTED`).
   - Tests: refund cash on a transfer-only order → 422; over-cash-refund a split order → 422; valid partial cash refund of a cash order → ok and drawer decreases correctly.

2. **Negative-stock floor (`inventory/service.py`, `schemas.py`).**
   - Behavior: under the product lock, block adjustments that would make on-hand negative unless an explicit audited intent is provided.
   - Data model: optional `reason` field. API: adjustment may 422 with `WOULD_GO_NEGATIVE`. Security: none. Backward-compat: additive validation; legitimate positive/within-range adjustments unaffected.
   - Tests: `-100` on 5 units → 422; explicit shrinkage path (if enabled) → allowed and audit-logged; `stock_take` to a lower count still works within floor.

3. **Single-open-shift partial unique index (migration + `shifts` repo/service).**
   - Behavior: DB rejects a second open shift per tenant; the open endpoint maps the `IntegrityError` to 409.
   - Data model: partial unique index. API: `POST /shifts` returns 409 if one is already open. Security: none. Backward-compat: matches the intended invariant already asserted at the app level; existing data must have ≤1 open shift per tenant (verify/backfill before adding the index).
   - Migration: guard against existing duplicate-open rows (close/repair them in a data step before creating the unique index, or the migration will fail).
   - Tests: two concurrent opens → exactly one succeeds; the other 409s.

4. **Payment-mix consistency (`reports/service.py`).**
   - Behavior: either subtract refunds from the per-method mix or add an explicit refunds line so `Σ mix (net) == net_sales`; document the chosen definition.
   - Data model: none. API: report response may gain a refunds line (additive). UI: reports show consistent totals. Backward-compat: additive; the reports redesign (this branch) should render the new line/label.
   - Tests: a day with a cash refund → payment mix reconciles to `net_sales`.

## Edge cases

- **Split payments:** refund validation must be per-method (30 cash + 20 transfer → at most 30 cash refundable in cash).
- **Sequential partial refunds:** cumulative per-method refunds must not exceed collected per method; track prior refunds by method.
- **Refund of a voided order / void of a refunded order:** already blocked under the order lock — preserve.
- **Zero/negative quantities:** existing `gt=0` guards hold; refund quantity caps hold.
- **Negative-stock intent:** if audited shrinkage is allowed, it must be a distinct, logged action — never the default path.
- **Concurrent shift open (double-tap, offline replay):** the partial unique index is the backstop; the app check + `IntegrityError`→409 handles the race.
- **Existing duplicate-open shifts in prod data:** the migration must detect and repair (or the unique-index creation fails) — include a pre-check/repair step.
- **Currency rounding:** all comparisons in `Decimal`/minor units; no float.
- **Offline-synced refunds:** the same per-method validation must apply on the sync path (refunds via sync, if any) — verify the code path.

## Security requirements

- Refund amounts remain server-derived; the new validation only *tightens* what a client can request.
- Inventory floor cannot be bypassed by a client flag unless an explicit, permission-gated, audited intent is provided.
- All refund/adjustment/shift mutations remain tenant-scoped and audit-logged.
- No weakening of the existing order/product row locks.

## Data migration and rollback

- **Migrations:** (a) partial unique index on open shifts — preceded by a data repair for any existing duplicate-open rows; (b) optional `inventory` reason column (additive).
- **Backfill:** repair duplicate-open shifts (close extras) before the unique index; none needed for refund/mix changes.
- **Compatibility window:** index creation is fast on SMB-scale tables; do it in a low-traffic window (per repo deploy practice) or `CREATE INDEX CONCURRENTLY` if outside a transaction (note Alembic transactional-DDL implications).
- **Rollback:** drop the index / column; revert code. Refund/mix logic changes are pure code reverts.
- **Recovery if deploy fails:** if the index creation fails due to existing duplicates, the repair step surfaces them; no data is destroyed.

## Testing strategy

- **Unit:** per-method refund ceiling; stock floor; payment-mix reconciliation.
- **Integration/API:** `test_refund_method_validation.py` (transfer-only refunded cash → 422; split over-cash → 422; valid → drawer math correct); inventory floor in `test_orders.py`/a new inventory test; concurrent shift-open in `test_shifts_open.py`.
- **DB:** migration up/down/up; duplicate-open repair.
- **Concurrency:** two-thread shift-open test; refund + concurrent sale (already race-safe on stock — regression only).
- **Regression:** `test_cash_reconciliation.py`, `test_refund_money.py`, `test_split_payment.py`, `test_reports_product_refunds.py` stay green; add payment-mix reconciliation assertions.
- **Manual:** in the local stack, sell via transfer, attempt a cash refund → blocked; adjust stock below zero → blocked; open two shifts in quick succession → one 409.

## Observability

- Audit-log every refund with its method + collected-vs-refunded context (no card/PII).
- Metric/alert on refund-method-rejection rate and negative-adjustment attempts (signals training or abuse).
- Log the 409 on duplicate shift-open with tenant + user (no PII).
- Payment-mix report should surface the refunds line so the reconciliation is visible to the owner.

## Acceptance criteria

- Given an order paid 100% by bank transfer, when a user requests a cash refund, then the API returns 422 (`REFUND_METHOD_EXCEEDS_COLLECTED`) and no `refund_payout` cash movement is created.
- Given a split order (30 cash + 20 transfer), when a user requests a 50 cash refund, then it is rejected; a ≤30 cash refund is allowed and reduces expected cash by exactly that amount.
- Given a product with 5 units on hand, when a manual adjustment of −100 is submitted without an explicit shrinkage intent, then the API returns 422 (`WOULD_GO_NEGATIVE`) and on-hand stays 5.
- Given a tenant with an open shift, when a second `POST /shifts` is submitted (including concurrently), then exactly one open shift exists and the duplicate returns 409.
- Given a day with a cash refund, when the payment-mix report is computed, then the net-of-refund mix reconciles to `net_sales` (or an explicit refunds line makes the totals tie).

## Verification commands

```bash
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run alembic downgrade -1 && docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run pytest app/tests/test_refund_method_validation.py app/tests/test_cash_reconciliation.py app/tests/test_refund_money.py app/tests/test_split_payment.py app/tests/test_shifts_open.py app/tests/test_reports_product_refunds.py -q
docker compose exec -T backend uv run pytest -q   # full regression
```

## Definition of done

- Refund method/amount validated per collected method; over-drain impossible (test-proven).
- Manual adjustments cannot go negative without an explicit audited intent.
- DB enforces a single open shift per tenant; duplicate-open repaired and prevented.
- Payment-mix reconciles to net sales (or is explicitly labeled with a refunds line).
- Two additive migrations reversible; full suite green.

## Risks and mitigations

- **Risk:** tightening `refund_payment_method` breaks existing UI flows. **Mitigation:** confirm the refund UI always sends a method; ship a clear 422 code; add a frontend guard.
- **Risk:** the single-open-shift migration fails on existing duplicate-open data. **Mitigation:** repair step before index creation; run on staging first.
- **Risk:** blocking negative stock frustrates legitimate shrinkage recording. **Mitigation:** provide the explicit audited shrinkage path as a product decision.
- **Risk:** payment-mix change confuses existing report consumers. **Mitigation:** document the definition; add the refunds line rather than silently changing method totals.

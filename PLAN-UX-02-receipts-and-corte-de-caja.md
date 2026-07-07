# PLAN-UX-02 — Receipts & Corte de Caja Completion

## Priority and rationale

**Rank 2 of the UX plans.** Kova is a POS for cash-heavy Mexican SMBs, and the two most repeated daily moments are **handing the customer a ticket** and **closing the drawer at end of day**. Today: the register does **not** print a receipt after a sale (the cashier must navigate to `/orders/:id` and print from there — F-POS-1), the shift close shows reconciliation on-screen but has **no corte-de-caja printout** (F-CORTE), and there is **no customer email capture or emailed receipt** at all (F-RCPT — missing both UI and backend). A POS that can't quickly produce a ticket or a printed drawer count at close undermines trust in its core job (trust risk T-3). The printing primitive already exists (`OrderDetail.tsx:229` uses `window.print()` with 80mm thermal CSS), so most of this is reuse.

## Goal

- After completing a sale, the cashier can print/show the receipt **from the register in one tap**, without navigating away.
- On closing a shift, the owner can print a **corte de caja** summary (opening cash, cash sales, cash in/out, refund payouts, expected vs counted, variance).
- Optionally capture a customer email at checkout and email them a receipt (new backend endpoint + Resend template), reusing the existing receipt data.

## Current behavior (repository evidence)

- **Receipt exists but only from order detail:** `orders/ReceiptTemplate.tsx` + `ReceiptDisplay.tsx` (`print-receipt-root`/`no-print`), `OrderDetail.tsx:229` `printTicket` → `window.print()`, 80mm thermal print CSS (`styles.css:208-238`, `@page size: 80mm auto`). Backend `GET /orders/{id}/receipt` (`ReceiptResponse`, `orders/schemas.py:115`).
- **Register post-sale:** `RegisterView.tsx:1272-1361` renders a success card + link to `/orders/:id`; no inline receipt, no print button.
- **Shift close:** `ShiftView.tsx` + `CloseShiftModal.tsx` compute and display expected vs counted cash and variance (frozen at close, `shifts/service.py:207-221`); **no print path** (no `window.print`, no printable summary).
- **No customer email at sale:** `OrderCreate` (`orders/schemas.py:34`) has no email field; `RegisterView` payment section captures none. Email service (`email/service.py`) is used only for auth/invite/subscription — `send_payment_receipt_email` is the **Stripe** receipt, not a POS sale receipt.

## Problems identified

1. F-POS-1: no one-tap receipt at the register → slower line, cashier leaves the register on every ticketed sale.
2. F-CORTE: no printable corte de caja → owner can't produce a drawer-count record at close.
3. F-RCPT: no digital (email) receipt and no customer email capture.

## Scope

**Included:** `RegisterView.tsx` (post-sale receipt action), `ShiftView.tsx`/`CloseShiftModal.tsx` + a new `CorteTemplate` (printable corte), optional `RegisterView` email field + a new backend receipt-email endpoint + Resend template. **Excluded:** a full customer CRM (PLAN deferred; email capture is a single optional field, not a customer record), thermal-printer hardware integration (browser print only, matching current approach), SMS receipts.

## Exact files to modify / create

- **`frontend/src/register/RegisterView.tsx`** — in the post-sale success card (`:1272-1361`), render the receipt inline (reuse `ReceiptTemplate`) and add a **"Imprimir recibo"** button calling the same print path as `OrderDetail`. Keep "ver orden" as secondary. Must work for a just-synced order (has `order` payload) and degrade gracefully for a queued-offline sale (offer print once synced).
- **`frontend/src/orders/ReceiptTemplate.tsx`** — ensure it renders from the register's in-memory order payload, not only a fetched receipt (small prop refactor if needed).
- **New `frontend/src/shifts/CorteTemplate.tsx`** — printable corte: business name/logo, shift open/close times, opening cash, cash sales, cash in/out, refund payouts, expected vs counted, variance. Reuse the 80mm print CSS class conventions.
- **`frontend/src/shifts/ShiftView.tsx` / `CloseShiftModal.tsx`** — add an **"Imprimir corte"** action on a closed shift (and optionally right after close), `window.print()` scoped to `CorteTemplate`.
- **`frontend/src/styles.css`** — extend the print rules to include the corte root (mirror `print-receipt-root`).
- **(Optional emailed receipt)**:
  - **`frontend/src/register/RegisterView.tsx`** — an optional "Correo del cliente (opcional)" field in the payment step; on submit include it in the order payload (additive, ignored if empty).
  - **`backend/app/orders/schemas.py`** — optional `customer_email` on `OrderCreate` (validated email, nullable) — additive, does not break the offline replay contract (BaseModel tolerates extra/missing).
  - **`backend/app/orders/service.py`** — after commit, fire-and-forget a receipt email if `customer_email` present (reuse the `email/service.py` fire-and-forget pattern; never block the sale).
  - **New `backend/app/email/receipt.py`** (or extend `email/service.py`) — a POS-sale receipt Resend template (es-MX), distinct from the Stripe receipt.

New files: `frontend/src/shifts/CorteTemplate.tsx`, `backend/app/email/receipt.py` (if emailed receipt is included), tests.

## Dependencies

- Reuses `ReceiptResponse`/`ReceiptTemplate` and the print CSS — no new libraries.
- Emailed receipt depends on Resend being configured (already used for auth/subscription); in local/dev it no-ops (existing behavior).
- Independent of PLAN-UX-01/03/04/05.

## Step-by-step implementation order

1. **Register one-tap receipt (`RegisterView.tsx`, `ReceiptTemplate.tsx`).** Behavior: after a synced sale, show/print the receipt inline. Data model: none. API: none (uses order payload already returned). UI: print button in success card. Security: none. Backward-compat: additive. Tests: RTL — success card renders receipt + print button; offline-queued sale shows "se imprimirá al sincronizar" instead.
2. **Corte de caja printout (`CorteTemplate.tsx`, `ShiftView.tsx`, `styles.css`).** Behavior: printable corte from the closed-shift data (already returned by `shifts` API). Data model: none. API: none (reuse shift response). UI: "Imprimir corte" on closed shift. Tests: RTL — corte renders opening/sales/in-out/expected/counted/variance; print root scoped.
3. **(Optional) Customer email capture + emailed receipt.**
   - `orders/schemas.py`: add nullable `customer_email` (additive). API impact: optional field; offline replays without it still work.
   - `orders/service.py`: fire-and-forget receipt email post-commit; never block or fail the sale on email error (reuse `email/service.py:28` swallow pattern, but log).
   - `email/receipt.py`: es-MX receipt template.
   - `RegisterView.tsx`: optional email field.
   - Tests: API test — order with `customer_email` triggers one email (mocked), without it triggers none; sale still succeeds if email send throws.

## Edge cases

- **Offline sale:** no receipt/print until synced (the order id/number doesn't exist yet). Show "el recibo estará disponible al sincronizar"; never imply a ticket was produced for an unsynced sale.
- **Split payment receipt:** must show each method + change (already in `ReceiptResponse`).
- **Refunded/voided order receipt:** reprint from order detail must reflect refunds/void (already supported via `ReceiptResponse.refunds/void`) — the register reprint is for the fresh sale only.
- **Corte for a shift with cash movements + refund payouts:** the printout must include them so expected cash ties to the on-screen number (companion: expected = opening + cash sales + cash_in − cash_out − refund_payout).
- **Corte after late-synced offline cash sale:** closed-shift totals are frozen (companion §11); the printed corte must match the frozen value, not a recomputed one.
- **Email: invalid/typo address:** validate format client + server; a bounce must not affect the sale (fire-and-forget).
- **Email: PII/consent:** capturing a customer email is personal data (LFPDPPP) — make it explicitly optional, don't persist it as a customer record here, and don't log it.
- **Printer/paper width:** browser print to 80mm thermal or A4 — the existing `@page size: 80mm auto` must not break on a standard printer (test both).
- **Double-print / rapid taps:** printing is idempotent (no state change); safe.

## Security requirements

- Customer email is optional, validated, not logged, and (in this scope) not persisted as a durable customer record — it's used transiently to send one receipt.
- Emailed receipt reuses tenant-scoped order data; the endpoint/service must only email receipts for the caller's tenant's orders.
- Email send is fire-and-forget and must never block, fail, or roll back the sale.
- No secrets/tokens/PII in logs.

## Data migration and rollback

- **No schema migration** for the print features. The optional `customer_email` is a request-only field (not stored) → no migration. If a future decision persists it, that's a separate additive migration.
- **Rollback:** revert frontend for print features; the optional email field/endpoint are additive and independently revertible.
- **Recovery if deploy fails:** print features are pure client; the emailed-receipt path is fire-and-forget, so a failure degrades to "no email sent," never a broken sale.

## Testing strategy

- **Unit/RTL:** register success-card receipt + print button; offline fallback copy; CorteTemplate content; optional email field.
- **Integration/API (backend):** order with `customer_email` → one receipt email (mock Resend); without → none; sale succeeds when email send raises; cross-tenant receipt-email attempt rejected.
- **E2E (Playwright):** complete a sale → receipt visible + print invoked (assert `window.print` called / print root present); close a shift → corte printable.
- **Regression:** existing `OrderDetail` print, receipt, and shifts tests stay green.
- **Manual:** print a receipt and a corte to PDF at 80mm and A4; verify layout; send a test receipt email in a Resend-configured env.

Exact test files: `frontend/src/register/RegisterView.test.tsx` (extend), `frontend/src/shifts/CorteTemplate.test.tsx` (new), `backend/app/tests/test_receipt_email.py` (new/extend — note an existing `test_payment_receipt_email` is the Stripe one), `frontend/e2e/register-sale.spec.ts` + `shifts.spec.ts` (extend).

## Observability

- Log (no PII) receipt-email send attempts: order id + tenant + success/failure (not the email address).
- Optional funnel event `receipt_printed` / `corte_printed` to measure adoption.
- Alert if receipt-email failure rate spikes (indicates Resend/template issue).

## Acceptance criteria

- Given a completed (synced) sale, when the cashier is on the success card, then the receipt is shown and a single tap prints it without leaving the register.
- Given an offline-queued sale, when it has not synced, then the UI offers no false "printed" state and explains the receipt will be available after sync.
- Given a closed shift, when the owner selects "Imprimir corte", then a corte de caja prints showing opening cash, cash sales, cash in/out, refund payouts, expected vs counted, and variance, and the expected figure matches the on-screen frozen value.
- Given a sale with a customer email entered, when it completes, then exactly one receipt email is sent to that address and the sale succeeds regardless of email outcome; with no email entered, no email is sent.
- Given a receipt-email request for an order of another tenant, then it is rejected.

## Verification commands

```bash
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test -- RegisterView CorteTemplate
npm --prefix frontend run test:e2e -- register-sale shifts
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run pytest app/tests/test_receipt_email.py app/tests/test_orders.py -q
npm --prefix frontend run build
```

## Definition of done

- One-tap receipt at the register (with honest offline fallback).
- Printable corte de caja on shift close, tying to the frozen expected cash.
- (If included) optional customer email + fire-and-forget emailed receipt, tenant-scoped, non-blocking, not logged.
- Tests green; lint/typecheck/build/pytest pass.

## Risks and mitigations

- **Risk:** print layout breaks on non-thermal printers. **Mitigation:** test 80mm + A4; the existing `@page` rule already handles thermal.
- **Risk:** emailing a customer receipt introduces PII/consent obligations. **Mitigation:** optional, transient (not stored), validated, not logged; add a short consent note; keep it out of scope if the team prefers print-only for beta.
- **Risk:** register reprint shows stale data for a later-refunded order. **Mitigation:** register reprint is for the fresh sale only; refunded reprints come from order detail (already refund-aware).
- **Risk:** email send blocks the checkout. **Mitigation:** strictly fire-and-forget after commit, mirroring the existing email pattern.

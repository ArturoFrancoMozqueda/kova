# Spec — Split Payment (Sprint 3)

## Problem Statement

Bakery customers often pay with mixed methods: part cash, part bank transfer. The
current single-payment model cannot represent this. Split payments are a beta
requirement for small food retail.

## Rules

- An order accepts 1–N payment entries via `payments: list[PaymentCreate]`.
- The sum of all `payment.amount` values must equal the order `total_amount`.
- Each payment entry has its own `method` (cash, bank_transfer, manual_card).
- Cash entries require `amount_tendered >= amount`; `change_due = tendered - amount`.
- Non-cash entries: `change_due = 0`, `amount_tendered = null`.
- Multiple cash entries are allowed (e.g. two customers splitting a cash payment).
- Duplicate methods within a single order are allowed.

## Validation Errors

| Condition | HTTP |
|---|---|
| Sum of payment amounts ≠ order total | 400 |
| Cash payment missing `amount_tendered` | 400 |
| Cash `amount_tendered` < cash `amount` | 400 |
| `payments` list is empty | 422 |

## Money Rules

- All amounts stored and computed as `Decimal` with 2 decimal places.
- Rounding mode: `ROUND_HALF_UP`.
- No floats anywhere in the payment path.

## API Impact

`POST /api/v1/orders` body changes:
- Before Sprint 3: `payment: PaymentCreate` (singular object)
- Sprint 3+: `payments: list[PaymentCreate]` (1-N entries)

`OrderResponse` changes:
- Before: `payment: PaymentResponse`
- Sprint 3+: `payments: list[PaymentResponse]`

## Audit Log

Single `orders.create` audit row per order — unchanged. The `changes` field
includes the full `payments` list.

## Idempotency

`Idempotency-Key` is still mandatory on `POST /api/v1/orders`. The request hash
covers the full payload including all payment entries.

## Test Matrix

| Scenario | Layer | Tag |
|---|---|---|
| Cash only, exact change | Unit | money |
| Cash only, change returned | Unit | money |
| Bank transfer only | Integration | orders |
| Manual card only | Integration | orders |
| Cash + bank transfer split | Integration | money, orders |
| Cash + manual card split | Integration | money, orders |
| Sum mismatch → 400 | Integration | orders |
| Cash tendered < amount → 400 | Integration | orders |
| BDD: split payment happy path | BDD | p0, orders |

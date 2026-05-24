# Refund Spec (Sprint 5)

## Problem Statement

After a cash sale, a cashier or manager needs to refund one or more items to a customer due to returns, defects, or customer requests. Refunds must be idempotent, auditable, and reverse inventory movements.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Refunds are core POS operational correctness: returning inventory, crediting customers, and maintaining accurate sales records.

## Functional Requirements

- Authenticated users with `orders.refund` can create a refund for an order in their tenant.
- A refund specifies which order items to refund and the quantity per item.
- A refund specifies how money was returned to the customer: cash, bank transfer, or manual card.
- Refund amount is calculated from the refunded item line totals (quantity × unit price).
- A refund can be partial (some items/quantities) or full (all items).
- Refund reason is required (e.g., `customer_return`, `defective`, `wrong_item`, `other`).
- Refunded inventory is returned to stock (reverse the original `inventory_movements`).
- Refund creates a new `refund_movements` record for audit/traceability.
- A refund cannot refund more than the original order quantity for any item.
- A refund cannot be created for an order that is already voided.
- Multiple refunds are allowed on the same order until full order quantity is consumed.
- Completed refunds are immutable.
- Cash refunds require an open shift and create a `refund_payout` cash movement for the refunded amount.

## Non-Functional Requirements

- Store money as database decimal/numeric values.
- Do not use floats in refund calculations.
- Cash refunds affect shift expected cash as a subtraction from the drawer.
- Store timestamps in UTC.
- Every refund and refund item includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Refund creation requires `orders.refund`.
- Listing/reading refunds requires authenticated tenant session.

## Idempotency

- `POST /api/v1/orders/{order_id}/refunds` requires `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Successful refund creation writes `orders.refund`.
- Cash refund creation also writes `shifts.cash_movement` for the automatic `refund_payout`.
- Refund includes reason and refunded amount.

## Offline Impact

- Sprint 5 creates refunds for online orders only.
- Offline refunds (refunding offline-queued orders) are Sprint 5+ if feasible.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Missing `Idempotency-Key` returns `400`.
- Order from another tenant returns `404`.
- Order not found returns `404`.
- Refund amount exceeds order total returns `400`.
- Refund exceeds remaining quantity for an item returns `400`.
- Order is voided returns `400`.
- Invalid refund reason returns `400`.
- Cash refund without an open shift returns `400` with a recovery message to open a shift first.

## Data Model Impact

- Add `refunds` table: `id`, `order_id`, `tenant_id`, `user_id`, `reason`, `refunded_amount`, `created_at`.
- Add `refund_items` table: `id`, `refund_id`, `order_item_id`, `quantity`, `unit_price`, `line_total`.
- Add inventory movement type: `refund_reversal` to track refunded stock.

## API Impact

- `POST /api/v1/orders/{order_id}/refunds` — create refund
- `GET /api/v1/orders/{order_id}/refunds` — list refunds for order
- `GET /api/v1/refunds/{refund_id}` — get refund details

## Acceptance Criteria

- A manager can refund one or more items from a completed order.
- A manager chooses how money was returned before submitting the refund.
- Refund amount is correctly calculated from refunded items.
- Cash refunds appear as `refund_payout` movements on the active shift.
- Inventory is reversed by the refunded quantity.
- Tenant B cannot refund Tenant A's orders.
- Duplicate idempotent refund with same key returns same response.
- Refund appears in order history/audit log.

# Current Sprint

## Active Sprint

Sprint: 5 - Refunds, Voids, and Receipts

## Sprint Goal

Support real operational corrections after a sale. Cashiers and managers can refund items, void entire orders, and retrieve complete receipts with full transaction history.

## Required Specs

- `specs/orders/refund.md`
- `specs/orders/void.md`
- `specs/orders/receipt.md`

## Required BDD / Test Scenarios

- Manager refunds one item from an order and inventory is restored.
- Manager refunds multiple items and total is calculated correctly.
- Refunding more than available quantity returns error.
- Manager voids a completed order and all inventory is reversed.
- Cannot void an order with existing refunds.
- Cannot refund a voided order.
- Duplicate refund with same idempotency key returns same response.
- Duplicate void with same idempotency key returns same response.
- Receipt displays refunds applied to an order.
- Receipt displays void status if order is voided.
- Tenant B cannot refund/void/receipt Tenant A's orders.

## Allowed Work

Only work on:

- Refund creation API and service
- Void creation API and service
- Inventory reversal for refunds and voids
- Receipt generation endpoint (extending Sprint 3 stub)
- Refund/void reason tracking and validation
- Permission gates for `orders.refund` and `orders.void`
- Audit logging for refunds and voids
- Idempotency for refund and void endpoints
- Backend and frontend tests
- Basic refund/void UI in order detail view
- Receipt display UI

## Explicitly Not Allowed This Sprint

Do not implement:

- Shift enforcement
- Advanced conflict resolution UI beyond happy path
- Refunding offline-queued orders (online only this sprint)
- Voiding offline-queued orders (online only this sprint)
- PDF receipt rendering or email delivery
- Split refunds (one refund at a time, full or partial items)
- Hardware printer SDKs
- Customer credit/store credit (only refund tracking)
- Multi-location
- Deferred scope from `docs/deferred-scope.md`

## Sprint 5 Tasks

### Backend

- [ ] Add `refunds` table with `id`, `order_id`, `tenant_id`, `user_id`, `reason`, `refunded_amount`, `created_at`.
- [ ] Add `refund_items` table with `id`, `refund_id`, `order_item_id`, `quantity`, `unit_price`, `line_total`.
- [ ] Add `voids` table with `id`, `order_id`, `tenant_id`, `user_id`, `reason`, `created_at`.
- [ ] Update `orders` table: add `status` field (`pending`, `completed`, `voided`).
- [ ] Add refund service with create, list, and validation logic.
- [ ] Add void service with create and validation logic.
- [ ] Add `POST /api/v1/orders/{order_id}/refunds` endpoint.
- [ ] Add `GET /api/v1/orders/{order_id}/refunds` endpoint.
- [ ] Add `GET /api/v1/refunds/{refund_id}` endpoint.
- [ ] Add `POST /api/v1/orders/{order_id}/void` endpoint.
- [ ] Validate refund reason enum.
- [ ] Validate void reason enum.
- [ ] Implement inventory reversal for refunds.
- [ ] Implement inventory reversal for voids.
- [ ] Add RLS policies for refunds and voids tables.
- [ ] Add permission checks: `orders.refund` and `orders.void`.
- [ ] Add audit logging for refund and void creation.
- [ ] Add idempotency support for refund and void endpoints.
- [ ] Extend `GET /api/v1/orders/{order_id}/receipt` to include refunds and void status.
- [ ] Add validation: cannot refund voided orders.
- [ ] Add validation: cannot void orders with existing refunds.
- [ ] Add validation: cannot refund more than remaining quantity per item.

### Frontend

- [ ] Add refunds and voids to order detail view.
- [ ] Add refund modal: select items, quantities, reason.
- [ ] Add void modal: confirm, enter reason.
- [ ] Display refunds in order item list (struck-through or separate section).
- [ ] Display void status banner if order is voided.
- [ ] Extend receipt display with refund section.
- [ ] Extend receipt display with void status section.
- [ ] Add loading/error states for refund/void operations.
- [ ] Add permission-based UI gating (only show refund/void if user has permission).
- [ ] Add success toast notifications.

### Tests

- [ ] Add refund BDD scenarios (happy path, permission denied, tenant isolation, idempotency).
- [ ] Add void BDD scenarios (happy path, permission denied, tenant isolation, idempotency).
- [ ] Add refund money golden tests.
- [ ] Add void inventory reversal tests.
- [ ] Add refund + void interaction tests (cannot coexist).
- [ ] Add receipt display tests for refunds and voids.
- [ ] Add backend refund integration tests.
- [ ] Add backend void integration tests.
- [ ] Add frontend refund/void modal E2E tests.

## Definition of Done

- Linked specs exist and are up-to-date.
- Linked BDD scenarios pass.
- Test matrix exists.
- Refund endpoint has tenant scoping, permission check, inventory reversal, audit, idempotency, and tests.
- Void endpoint has tenant scoping, permission check, inventory reversal, audit, idempotency, and tests.
- Cannot refund voided orders; cannot void orders with refunds.
- Receipt endpoint includes refund/void information.
- Refund/void UIs are gated by permission.
- All money calculations use Decimal.
- Inventory reversal is correct for both refunds and voids.
- Quality gates pass.

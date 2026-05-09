# Current Sprint

## Active Sprint

Sprint: 3 — Split Payment + Receipt Stub Polish

## Sprint Goal

Allow a cashier to complete an online sale with cash, bank transfer, or manual card payment while preserving tenant isolation, Decimal money handling, audit logs, and idempotency.

## Required Specs

- `specs/orders/cash_sale.md`
- `specs/orders/manual_payment.md`
- `specs/inventory/decrement.md`
- `specs/pricing/money_rules.md`

## Required BDD / Test Scenarios

- Cashier completes a cash sale.
- Cashier records a bank transfer sale.
- Tenants cannot read each other's orders.

## Allowed Work

Only work on:

- Orders, order items, payments, and inventory movement data model
- Online order creation endpoint
- Single payment recording for cash, bank transfer, and manual card
- Decimal pricing calculator
- Sale-driven inventory movement rows
- Order idempotency
- Order audit logs
- Tenant isolation, permission, money, and inventory tests

## Explicitly Not Allowed This Sprint

Do not implement:

- Split payment
- Refunds or voids
- Offline sync
- Receipt rendering beyond response data
- Shift enforcement
- Tax engine
- Discounts
- Integrated card processing or Stripe Terminal
- Multi-location
- Deferred scope from `docs/deferred-scope.md`

## Sprint 2 Tasks

### Backend

- [x] Create `orders` table.
- [x] Create `order_items` table.
- [x] Create `payments` table.
- [x] Create `inventory_movements` table.
- [x] Add RLS policies.
- [x] Add order models.
- [x] Add order schemas.
- [x] Add order repository.
- [x] Add pricing calculator.
- [x] Add order service.
- [x] Add order router.
- [x] Add `POST /api/v1/orders`.
- [x] Add `GET /api/v1/orders/{order_id}`.
- [x] Add idempotency for order creation.
- [x] Add audit logging for order creation.
- [x] Add sale inventory movements for tracked products.

### Tests

- [x] Add online sale BDD scenarios.
- [x] Add money golden tests.
- [x] Add order creation tests.
- [x] Add manual payment tests.
- [x] Add permission denied tests.
- [x] Add tenant isolation tests.
- [x] Add idempotency replay tests.
- [x] Add inventory movement tests.

## Definition of Done

- Linked specs exist.
- Linked BDD scenarios pass.
- Test matrix exists.
- Order write endpoint has tenant scoping, permission check, idempotency, audit log, and automated tests.
- Money calculations use Decimal and golden tests pass.
- Migrations are Alembic-managed and reversible.
- API docs include order endpoints.
- Quality gates pass.

# Cash Sale Spec

## Problem

Cashiers need to complete a simple online sale from active catalog products and record a cash payment.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Cash sales are the first transaction path in the north star flow and the smallest sellable POS behavior after catalog setup.

## Functional Requirements

- Authenticated users with `orders.create` can create an order for their tenant.
- Order items reference active products in the same tenant.
- The server prices each line from current product price, not client-provided totals.
- Sprint 2 supports exactly one payment per order.
- Cash payment amount tendered must be greater than or equal to the order total.
- Cash change due is computed as `amount_tendered - total`.
- Completed orders are immutable in Sprint 2.

## Non-Functional Requirements

- Store money as database decimal/numeric values.
- Do not use floats in money paths.
- Store timestamps in UTC.
- Every order, order item, payment, and inventory movement includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Order creation requires `orders.create`.
- Listing/reading created orders requires an authenticated tenant session.

## Idempotency

- `POST /api/v1/orders` requires `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Successful order creation writes `orders.create`.

## Offline Impact

- Sprint 2 creates online orders only.
- Offline queue, retry, and dead-letter behavior are Sprint 4.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Missing `Idempotency-Key` returns `400`.
- Product from another tenant returns `404`.
- Inactive product returns `404`.
- Payment mismatch returns `400`.

## Data Model Impact

- Add `orders`, `order_items`, `payments`, and `inventory_movements`.

## API Impact

- `POST /api/v1/orders`
- `GET /api/v1/orders/{order_id}`

## Acceptance Criteria

- A cashier can create an order with a cash payment.
- The order total is calculated from server-side product prices.
- The response includes order items, payment, total, and change due.
- Tenant B cannot read Tenant A's order.
- Duplicate idempotent create returns the same order response.

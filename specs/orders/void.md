# Void Spec (Sprint 5)

## Problem Statement

A cashier or manager needs to cancel an entire completed order due to operator error, incorrect product selection, or system issues. A void reverses all inventory movements and marks the order as cancelled without creating a customer-facing refund.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Voids allow quick correction of mistakes without manual refund tracking, keeping the register accurate and reducing reconciliation friction.

## Functional Requirements

- Authenticated users with `orders.void` can void an order in their tenant.
- A void cancels the entire order.
- Void reason is required (e.g., `operator_error`, `wrong_product`, `system_issue`, `other`).
- Voiding reverses all inventory movements from the original sale.
- A void cannot be created for an order that is already voided.
- A void cannot be created for an order that has existing refunds (refund first, then void).
- Void creates an audit log entry.
- Voided orders remain queryable but marked with status `voided`.

## Non-Functional Requirements

- Store timestamps in UTC.
- Every void includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for tenant-scoped tables.

## Permissions

- Void creation requires `orders.void`.
- Listing/reading voided orders requires authenticated tenant session.

## Idempotency

- `POST /api/v1/orders/{order_id}/void` requires `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Successful void writes `orders.void` with reason.

## Offline Impact

- Sprint 5 voids online orders only.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Missing `Idempotency-Key` returns `400`.
- Order from another tenant returns `404`.
- Order not found returns `404`.
- Order is already voided returns `400`.
- Order has existing refunds returns `400`.
- Invalid void reason returns `400`.

## Data Model Impact

- Add `voids` table: `id`, `order_id`, `tenant_id`, `user_id`, `reason`, `created_at`.
- Update `orders` table: add `status` field that can be `pending`, `completed`, `voided`.

## API Impact

- `POST /api/v1/orders/{order_id}/void` — void an order

## Acceptance Criteria

- A manager can void a completed order.
- Void reverses all inventory from the sale.
- Tenant B cannot void Tenant A's orders.
- Duplicate idempotent void with same key returns same response.
- Void appears in order audit log.
- Order marked with status `voided`.

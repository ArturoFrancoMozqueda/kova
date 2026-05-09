# Stock Take Spec

## Problem

Owners need to reconcile system stock with a physical count.

## Target Users

- Tenant owner
- Manager

## Business Value

Stock take lets beta tenants recover from missed sales, damaged goods, or setup mistakes without editing historical sales.

## Functional Requirements

- A user with `inventory.adjust` can set counted stock for a tracked product.
- The service computes the delta between current stock and counted stock.
- A non-zero stock take delta creates an `inventory_movements` row with type `stock_take`.
- A zero delta is accepted and audited but does not create a movement row.

## Non-Functional Requirements

- Current stock is calculated from the inventory movement ledger.
- Stock take is tenant-scoped.
- Product row is locked while computing the stock-take delta.

## Permissions

- Requires `inventory.adjust`.

## Idempotency

- Stock take writes require `Idempotency-Key`.

## Audit Log Behavior

- Every stock take writes an audit log row with action `inventory.stock_take`.

## Offline Impact

- Online only in Sprint 7.

## Error States

- Negative counted quantity returns validation error.
- Unknown product returns 404.
- Untracked product returns 400.

## Acceptance Criteria

- Counted stock becomes the new stock on hand.
- The generated movement delta equals counted minus previous stock.

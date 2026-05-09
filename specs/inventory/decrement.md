# Inventory Decrement Spec

## Problem

Sales must create an auditable inventory trail so stock decrement can become reliable before beta.

## Target Users

- Tenant owner
- Manager
- Cashier

## Business Value

Inventory movement history is the foundation for later stock views, stock takes, and reconciliation.

## Functional Requirements

- When an order is created, every item for a product with `track_inventory=true` creates an inventory movement.
- Sale movements use type `sale`.
- Sale movement quantity is negative.
- Product row is locked before writing sale inventory movements.
- Sprint 2 does not expose stock adjustment UI or stock-on-hand views.

## Non-Functional Requirements

- Every inventory movement includes `tenant_id`.
- Movement writes are inside the same transaction as order creation.
- PostgreSQL RLS is enabled for inventory movements.

## Permissions

- Sale-driven inventory movement is authorized by `orders.create`.
- Manual inventory adjustment is deferred.

## Idempotency

- Order idempotency prevents duplicate sale movements.

## Audit Log Behavior

- Order creation audit log references the order. Inventory movement rows are the detailed inventory audit trail.

## Offline Impact

- Online only in Sprint 2.

## Error States

- If order creation fails, no inventory movement is committed.

## Acceptance Criteria

- A tracked product creates a negative sale movement during order creation.
- An untracked product does not create an inventory movement.

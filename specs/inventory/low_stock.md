# Low Stock Spec

## Problem

Owners need to quickly see products that require replenishment.

## Target Users

- Tenant owner
- Manager

## Business Value

Low-stock visibility prevents missed sales for bakery and small food retail tenants.

## Functional Requirements

- A tracked product can have an optional low-stock threshold.
- The stock view returns `is_low_stock=true` when stock on hand is less than or equal to the threshold.
- A low-stock endpoint returns only low-stock tracked products.
- Threshold updates require `inventory.adjust`.

## Non-Functional Requirements

- Thresholds are tenant-scoped through the product row.
- Stock values are computed from inventory movements.

## Permissions

- Reading stock requires an authenticated tenant session.
- Updating thresholds requires `inventory.adjust`.

## Idempotency

- Threshold updates require `Idempotency-Key`.

## Audit Log Behavior

- Threshold updates write an audit log row with action `inventory.low_stock_threshold.update`.

## Offline Impact

- Online only in Sprint 7.

## Error States

- Negative threshold returns validation error.
- Unknown product returns 404.

## Acceptance Criteria

- Products at or below threshold appear in the low-stock list.
- Tenant B cannot see Tenant A's low-stock products.

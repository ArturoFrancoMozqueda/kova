# Inventory Adjustment Spec

## Problem

Owners and managers need a controlled way to correct stock outside the sale/refund/void flow.

## Target Users

- Tenant owner
- Manager

## Business Value

Manual corrections keep stock usable during beta without introducing a full warehouse workflow.

## Functional Requirements

- A user with `inventory.adjust` can apply a positive or negative quantity delta to a tracked product.
- Adjustments create an `inventory_movements` row with type `adjustment`.
- Adjustments require a non-empty reason.
- The stock view reflects the adjustment immediately.

## Non-Functional Requirements

- Every movement includes `tenant_id`.
- Product lookup and movement creation are tenant-scoped.
- Movement writes happen inside one transaction.

## Permissions

- Requires `inventory.adjust`.

## Idempotency

- Adjustment writes require `Idempotency-Key`.
- Reusing the same key with the same body returns the stored response.

## Audit Log Behavior

- Every adjustment writes an audit log row with action `inventory.adjust`.

## Offline Impact

- Online only in Sprint 7.

## Error States

- Unknown product returns 404.
- Untracked product returns 400.
- Zero quantity delta returns validation error.
- Missing permission returns 403.

## Acceptance Criteria

- A valid adjustment changes stock on hand.
- A duplicate adjustment key does not duplicate movement rows.
- Tenant B cannot adjust Tenant A's stock.

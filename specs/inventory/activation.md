# Inventory Activation

## Decision

Inventory setup starts from the Inventory empty state and sends the owner/manager to the product
setup flow. A product is considered inventory-ready when `track_inventory = true` and a stock
count or threshold has been configured.

## Acceptance Criteria

- Empty inventory explains that no products are tracked.
- The primary action opens catalog/product setup instead of leaving the user stranded.
- Product setup exposes `track_inventory` and `low_stock_threshold`.
- Inventory adjustments remain permission-gated by `inventory.adjust`.
- All tracked stock views are tenant-scoped.

## Test Matrix

| Scenario | Layer | Expected |
|---|---|---|
| Empty inventory | E2E | User sees a clear action to choose a product to track. |
| Product tracking enabled | E2E/API | Product appears in inventory stock list. |
| Low-stock threshold set | API | Low-stock endpoint includes product when stock is at or below threshold. |

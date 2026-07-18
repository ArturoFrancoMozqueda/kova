# ADR-010: Product Cost and Sale-Time Snapshots

## Status

Accepted

## Context

Kova stores sale prices but not product costs. Without a cost basis, the product cannot
calculate trustworthy COGS or gross margin. Cost also changes over time, so reports must
not join historical sales to the product's current value.

## Decision

- `products.cost_price` stores the latest known unit cost as `NUMERIC(12, 2)`.
- `NULL` means the cost is unknown. It must never be interpreted or backfilled as zero.
- `order_items.unit_cost` snapshots `products.cost_price` when the server creates the
  order item. The client and offline queue never provide this value.
- Existing products and historical order items remain `NULL`; Kova does not invent
  historical costs.
- R1 uses the last manually entered cost. Moving weighted-average costing belongs to the
  future purchases/receiving release and does not rewrite existing snapshots.
- Product cost excludes modifier-specific cost because modifier costs are not modeled yet.
- Only roles with `catalog.update` may see or change the cost. Other catalog consumers
  receive `cost_price: null`.

## Consequences

### Positive

- Future margin reports use immutable sale-time cost data.
- Offline sale payloads and idempotency remain unchanged.
- Missing-cost coverage can be measured honestly.
- Updating a product cost cannot rewrite prior profitability.

### Negative

- Margin remains unknown for products or sales without a captured cost.
- Last cost is less precise than weighted average until purchasing is implemented.
- Modifier profitability cannot be calculated independently in R1.

## Validation

- Reject negative costs at the API and database layers.
- Verify create, update, clear-to-`NULL`, permission masking, and audit behavior.
- Verify online and offline sales snapshot the server's current cost.
- Verify changing the product later does not change an existing order-item snapshot.


# Modifiers Spec

## Problem

Bakeries and restaurants need to offer product variants and add-ons — size, milk type, extras, toppings — without creating a separate product for every combination. A product must be configurable at the point of sale.

## Target Users

- Tenant owner: creates and manages modifier groups and options
- Cashier: selects modifiers when adding a product to the cart

## Business Value

Enables bakeries (pan de tamaño chico/grande) and cafés (type of milk, syrup add-ons) to configure their menu correctly. Without modifiers, every combination requires a separate SKU.

## Functional Requirements

- A **modifier group** belongs to a tenant and has a name, required flag, min/max selection counts, and an ordered list of options.
- A **modifier option** has a name and a `price_delta` (Decimal ≥ 0 for now; negative deltas deferred).
- A product can have zero or more modifier groups assigned, each with its own display order.
- When the cashier adds a product to the cart:
  - Products with no modifier groups are added directly.
  - Products with modifier groups open a selection modal.
  - Required groups must have a selection that satisfies `min_selections ≤ count ≤ max_selections`.
- The effective unit price of a cart item = `product.price_amount + sum(selected_option.price_delta)`.
- Order creation records the selected modifier options per order item (snapshots name and price_delta at time of order).
- The receipt shows selected modifiers under each line item.

## Non-Functional Requirements

- All modifier tables are tenant-scoped (`tenant_id` on modifier groups and options).
- RLS applied to modifier tables.
- Modifier option price_delta uses `Decimal(12, 4)` to allow fractional pricing.
- No floats in pricing path.
- Selected modifier snapshots are immutable after order creation (order_item_modifiers stores name + price_delta at time of order).

## Permissions

- `catalog.create` / `catalog.update` / `catalog.delete` — manage modifier groups and options (owner/manager)
- `orders.create` — select modifiers when creating an order (cashier)

## Idempotency

- Modifier group/option creation endpoints use `Idempotency-Key` header (same as catalog endpoints).

## Data Model Impact

### New tables

```
modifier_groups
  id, tenant_id, name, is_required, min_selections, max_selections, sort_order, is_active

modifier_options
  id, tenant_id, group_id, name, price_delta, sort_order, is_active

product_modifier_groups
  id, product_id, modifier_group_id, sort_order
  (no tenant_id — derived from product)

order_item_modifiers
  id, tenant_id, order_item_id
  modifier_group_id, modifier_group_name (snapshot)
  modifier_option_id, modifier_option_name (snapshot)
  price_delta_amount (snapshot)
```

### Changed tables

- `OrderItemCreate.modifier_option_ids: list[UUID] = []` — IDs of selected options

## API Impact

### New endpoints

- `GET /api/v1/catalog/modifier-groups` — list all modifier groups with options
- `POST /api/v1/catalog/modifier-groups` — create modifier group
- `PATCH /api/v1/catalog/modifier-groups/{id}` — update modifier group
- `DELETE /api/v1/catalog/modifier-groups/{id}` — deactivate modifier group
- `POST /api/v1/catalog/modifier-groups/{id}/options` — add option to group
- `PATCH /api/v1/catalog/modifier-groups/{id}/options/{option_id}` — update option
- `DELETE /api/v1/catalog/modifier-groups/{id}/options/{option_id}` — deactivate option
- `PUT /api/v1/catalog/products/{id}/modifier-groups` — set modifier group assignments for product

### Changed endpoints

- `GET /api/v1/catalog/products` — response includes `modifier_groups: []` per product
- `POST /api/v1/orders` — `items[].modifier_option_ids: list[UUID]` accepted
- `POST /api/v1/sync/offline-sales` — same change (via OrderCreate)

## Offline Impact

- Modifier groups are loaded with the product catalog at register load.
- Selected `modifier_option_ids` are stored in the offline sale queue payload.
- No additional offline-specific behavior required.

## Error States

- Missing required modifier selection → 400 "Modifier group '{name}' requires at least {min} selection(s)"
- Too many selections → 400 "Modifier group '{name}' allows at most {max} selection(s)"
- Modifier option not found or inactive → 400 "Modifier option not found"
- Option does not belong to product's modifier groups → 400 "Modifier option not valid for this product"

## Audit Log

- `catalog.modifier_group.create`, `catalog.modifier_group.update`, `catalog.modifier_group.deactivate`
- `catalog.modifier_option.create`, `catalog.modifier_option.update`, `catalog.modifier_option.deactivate`

## Money / Rounding

- `price_delta` stored as `Decimal(12, 4)`.
- Effective unit price = `money(product.price_amount + sum(price_delta))` — rounded to 2dp using `ROUND_HALF_UP`.
- Line total = `money(effective_unit_price * quantity)`.

## UI States

- Catalog: modifier groups list, create/edit drawer, option list within group, assign groups to product
- Register: modifier selection modal (shows on "Add" if product has modifier groups), validation before confirm
- Receipt: each line item shows selected modifiers indented below product name

## Acceptance Criteria

- Owner can create modifier group "Size" with options "Small (+0.00)" and "Large (+10.00)".
- Owner assigns "Size" to "Café Americano".
- Cashier adds "Café Americano Large" to cart — unit price is product price + 10.00.
- Order is created with `order_item_modifiers` snapshot.
- Receipt shows "  → Large +$10.00" under the line item.
- Missing required group on order create → 400.
- Cashier cannot create/edit modifier groups → 403.
- Tenant isolation: modifiers from Tenant A not visible to Tenant B.

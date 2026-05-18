# Modifiers Spec

## Problem

Bakeries and restaurants need product variants and add-ons such as size, milk type, extras, and toppings without creating a separate product for every combination. A product must be configurable at the point of sale.

## Target Users

- Tenant owner: creates and manages modifier groups and options.
- Cashier: selects modifiers when adding a product to the cart.

## Business Value

Modifiers let bakeries and cafes configure menus correctly without exploding the SKU count.

## Functional Requirements

- A modifier group belongs to a tenant and has a name, required flag, min/max selection counts, and an ordered list of options.
- A modifier option has a name and a non-negative `price_delta` Decimal.
- A product can have zero or more modifier groups assigned, each with its own display order.
- Products with no modifier groups are added directly to the cart.
- Products with modifier groups open a selection modal before being added to the cart.
- Required groups must satisfy `min_selections <= selected_count <= max_selections`.
- Effective unit price is `product.price_amount + sum(selected_option.price_delta)`.
- Order creation records selected modifier options per order item as immutable snapshots.
- Receipts show selected modifiers under each line item.

## Non-Functional Requirements

- All modifier tables are tenant-scoped: modifier groups, options, product assignments, and order item snapshots.
- RLS is applied to all modifier tables.
- Modifier option `price_delta` uses `Decimal(12, 2)` to match sale-money precision.
- No floats are allowed in the pricing path.
- Database constraints must reject orphan modifier options, orphan product assignments, orphan order item modifier snapshots, and cross-tenant product/modifier assignment.

## Permissions

- `catalog.create`, `catalog.update`, `catalog.delete`: manage modifier groups and options for owner/manager.
- `orders.create`: select modifiers while creating an order for cashier and above.

## Idempotency

- Modifier group and option creation endpoints require the `Idempotency-Key` header.

## Data Model Impact

### New tables

```text
modifier_groups
  id, tenant_id, name, is_required, min_selections, max_selections, sort_order, is_active
  UNIQUE (tenant_id, id)

modifier_options
  id, tenant_id, group_id, name, price_delta, sort_order, is_active
  FK (tenant_id, group_id) -> modifier_groups(tenant_id, id)
  UNIQUE (tenant_id, id)

product_modifier_groups
  id, tenant_id, product_id, modifier_group_id, sort_order
  FK (tenant_id, product_id) -> products(tenant_id, id)
  FK (tenant_id, modifier_group_id) -> modifier_groups(tenant_id, id)
  UNIQUE (tenant_id, product_id, modifier_group_id)

order_item_modifiers
  id, tenant_id, order_item_id
  modifier_group_id, modifier_group_name (snapshot)
  modifier_option_id, modifier_option_name (snapshot)
  price_delta_amount (snapshot)
  FK (tenant_id, order_item_id) -> order_items(tenant_id, id)
  FK (tenant_id, modifier_group_id) -> modifier_groups(tenant_id, id)
  FK (tenant_id, modifier_option_id) -> modifier_options(tenant_id, id)
```

### Changed payloads

- `OrderItemCreate.modifier_option_ids: list[UUID] = []`: IDs of selected options.

## API Impact

- `GET /api/v1/catalog/modifier-groups`: list all modifier groups with options.
- `POST /api/v1/catalog/modifier-groups`: create modifier group.
- `PATCH /api/v1/catalog/modifier-groups/{id}`: update modifier group.
- `DELETE /api/v1/catalog/modifier-groups/{id}`: deactivate modifier group.
- `POST /api/v1/catalog/modifier-groups/{id}/options`: add option to group.
- `PATCH /api/v1/catalog/modifier-groups/{id}/options/{option_id}`: update option.
- `DELETE /api/v1/catalog/modifier-groups/{id}/options/{option_id}`: deactivate option.
- `PUT /api/v1/catalog/products/{id}/modifier-groups`: set modifier group assignments for product.
- `GET /api/v1/catalog/products`: response includes `modifier_groups`.
- `POST /api/v1/orders`: accepts `items[].modifier_option_ids`.
- `POST /api/v1/sync/offline-sales`: accepts the same order payload through `OrderCreate`.

## Offline Impact

- Modifier groups are loaded with the product catalog at register load.
- Selected `modifier_option_ids` are stored in the offline sale queue payload.
- No additional offline-specific behavior is required.

## Error States

- Missing required modifier selection returns 400.
- Too many selections returns 400.
- Modifier option not found or inactive returns 400.
- Option not assigned to the product returns 400.
- Cross-tenant product assignment or guessed product ID returns 404.

## Audit Log

- `catalog.modifier_group.create`
- `catalog.modifier_group.update`
- `catalog.modifier_group.deactivate`
- `catalog.modifier_option.create`
- `catalog.modifier_option.update`
- `catalog.modifier_option.deactivate`
- `catalog.product.modifier_groups.set`

## Money / Rounding

- `price_delta` is stored as `Decimal(12, 2)`.
- Effective unit price is rounded to 2 decimals using `ROUND_HALF_UP`.
- Line total is `money(effective_unit_price * quantity)`.

## Acceptance Criteria

- Owner can create modifier group `Size` with options `Small (+0.00)` and `Large (+10.00)`.
- Owner assigns `Size` to `Cafe Americano`.
- Cashier adds `Cafe Americano Large` to cart and unit price includes the modifier.
- Order is created with an `order_item_modifiers` snapshot.
- Receipt shows the selected modifier under the line item.
- Missing required group on order create returns 400.
- Cashier cannot create/edit modifier groups and receives 403.
- Tenant B cannot see or mutate Tenant A modifiers.
- Cross-tenant product/modifier assignment is rejected at the service layer and by tenant-scoped database foreign keys.

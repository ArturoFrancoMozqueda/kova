# Database Integrity Spec

## Problem

Tenant isolation cannot rely only on route handlers. Database constraints must prevent orphan records and cross-tenant joins for critical POS data.

## Scope

PB-5 covers modifier integrity first because modifier assignments connect catalog products, modifier groups, modifier options, and order item snapshots.

## Requirements

- Tenant-scoped join tables must include `tenant_id` unless an ADR documents a stronger exception.
- Cross-tenant relationships must be impossible through database constraints.
- Tables that reference tenant-scoped parents should use composite foreign keys on `(tenant_id, parent_id)`.
- Orphan modifier options must be rejected.
- Orphan product modifier assignments must be rejected.
- Orphan order item modifier snapshots must be rejected.
- RLS policies on tenant-scoped tables must include both `USING` and `WITH CHECK` where writes are possible.

## Modifier Constraints

```text
modifier_options(tenant_id, group_id)
  -> modifier_groups(tenant_id, id)

product_modifier_groups(tenant_id, product_id)
  -> products(tenant_id, id)

product_modifier_groups(tenant_id, modifier_group_id)
  -> modifier_groups(tenant_id, id)

order_item_modifiers(tenant_id, order_item_id)
  -> order_items(tenant_id, id)

order_item_modifiers(tenant_id, modifier_group_id)
  -> modifier_groups(tenant_id, id)

order_item_modifiers(tenant_id, modifier_option_id)
  -> modifier_options(tenant_id, id)
```

## Acceptance Criteria

- Tenant A cannot assign a Tenant A modifier group to a Tenant B product.
- Direct database inserts that attempt cross-tenant product modifier assignments fail.
- Inspector tests confirm the tenant-scoped FK constraints exist.
- Existing invalid modifier rows are removed before constraints are applied.

## Rollback

Rollback drops the new modifier integrity constraints, removes `product_modifier_groups.tenant_id`, and restores the prior derived RLS policy.

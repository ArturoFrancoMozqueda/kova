# Catalog Products Spec

## Problem

Tenants need to create the products that will later appear in the register.

## Target Users

- Tenant owner
- Tenant manager

## Business Value

Products are the first commercial catalog unit needed before a sale can be created.

## Functional Requirements

- Authenticated owners and managers can create products for their tenant.
- Products can optionally belong to an active category in the same tenant.
- Product names are required.
- Product prices use decimal money values and must be greater than or equal to zero.
- SKU is optional and unique per tenant when present.
- Products can be listed, updated, and soft-deactivated.
- Deactivated products are excluded from default active lists.

## Non-Functional Requirements

- Store timestamps in UTC.
- Store money using database decimal/numeric values, never floats.
- Every product row includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for the products table.

## Permissions

- Create/update/deactivate requires `catalog.create`, `catalog.update`, or `catalog.delete`.
- Listing requires an authenticated tenant session.

## Idempotency

- Product create/update/deactivate endpoints require `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Product create writes `catalog.product.create`.
- Product update writes `catalog.product.update`.
- Product deactivate writes `catalog.product.deactivate`.

## Offline Impact

- No offline write behavior in Sprint 1.
- Future offline register reads can cache active products.

## Money/Locale/Rounding

- `price_amount` is a decimal with two fractional digits.
- API accepts decimal strings or numbers parsed into `Decimal`.
- No floating point arithmetic is introduced.
- Currency is not stored on products in Sprint 1; tenant settings will supply default currency later.

## Error States

- Duplicate SKU in a tenant returns `400`.
- Category from another tenant returns `404`.
- Missing permission returns `403`.
- Missing auth returns `401`.
- Unknown product returns `404`.

## Data Model Impact

- Add `products` table with `id`, `tenant_id`, `category_id`, `name`, `description`, `sku`, `price_amount`, `track_inventory`, `is_active`, `created_at`, and `updated_at`.

## API Impact

- `GET /api/v1/catalog/products`
- `POST /api/v1/catalog/products`
- `PATCH /api/v1/catalog/products/{product_id}`
- `DELETE /api/v1/catalog/products/{product_id}`

## Acceptance Criteria

- A tenant owner can create and list a product.
- Tenant B cannot see Tenant A products.
- A cashier cannot create a product.
- Duplicate idempotent product create returns the stored response.
- Product prices are serialized as decimal strings.

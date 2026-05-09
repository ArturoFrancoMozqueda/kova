# Catalog Categories Spec

## Problem

Bakery and small food retail tenants need a simple way to group products before they can sell through the register.

## Target Users

- Tenant owner
- Tenant manager

## Business Value

Categories make catalog setup faster and keep the future register product grid scannable.

## Functional Requirements

- Authenticated owners and managers can create categories for their tenant.
- Authenticated owners and managers can list categories for their tenant.
- Category names are required and unique per tenant.
- Categories are tenant-scoped and never visible across tenants.
- Categories can be renamed and deactivated.
- Deactivated categories are excluded from default active lists.

## Non-Functional Requirements

- Store timestamps in UTC.
- Every category row includes `tenant_id`.
- Every query is scoped by tenant in the service/repository layer.
- PostgreSQL RLS is enabled for the categories table.

## Permissions

- Create/update/deactivate requires `catalog.create`, `catalog.update`, or `catalog.delete`.
- Listing requires an authenticated tenant session.

## Idempotency

- Category create/update/deactivate endpoints require `Idempotency-Key`.
- Replaying the same request body with the same key returns the same response.
- Reusing a key with a different body returns `400`.

## Audit Log Behavior

- Category create writes `catalog.category.create`.
- Category update writes `catalog.category.update`.
- Category deactivate writes `catalog.category.deactivate`.

## Offline Impact

- No offline write behavior in Sprint 1.
- Future offline catalog reads can cache active categories.

## Error States

- Duplicate category name returns `400`.
- Missing permission returns `403`.
- Missing auth returns `401`.
- Unknown category returns `404`.

## Data Model Impact

- Add `categories` table with `id`, `tenant_id`, `name`, `description`, `sort_order`, `is_active`, `created_at`, and `updated_at`.

## API Impact

- `GET /api/v1/catalog/categories`
- `POST /api/v1/catalog/categories`
- `PATCH /api/v1/catalog/categories/{category_id}`
- `DELETE /api/v1/catalog/categories/{category_id}`

## Acceptance Criteria

- A tenant owner can create and list a category.
- Tenant B cannot see Tenant A categories.
- A cashier cannot create a category.
- Duplicate idempotent category create returns the stored response.

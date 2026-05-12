# Current Sprint

## Active Sprint

Sprint: 11 - Catalog Management

## Sprint Goal

Allow a tenant owner or manager to create and manage the catalog (categories and products) that will power the register in Sprint 12. Without a real catalog, the POS register cannot function.

## Required Specs

- `specs/catalog/categories.md` ✅
- `specs/catalog/products.md` ✅
- `specs/catalog/catalog_foundation.feature` ✅

## Required BDD / Test Scenarios

- Owner can create a category.
- Owner can list categories for their tenant.
- Tenant B cannot see Tenant A categories.
- Cashier cannot create or update a category.
- Duplicate category name returns 400.
- Idempotent category create replays the stored response.
- Owner can create a product with a category.
- Owner can create a product without a category.
- Tenant B cannot see Tenant A products.
- Cashier cannot create or update a product.
- Duplicate SKU in the same tenant returns 400.
- Product prices are serialized as decimal strings (never floats).
- Idempotent product create replays the stored response.

## Allowed Work

Only work on:

- `categories` table + migration
- `products` table + migration
- Catalog service, repository, router, and schemas (backend)
- `GET /api/v1/catalog/categories`
- `POST /api/v1/catalog/categories`
- `PATCH /api/v1/catalog/categories/{category_id}`
- `DELETE /api/v1/catalog/categories/{category_id}` (soft deactivate)
- `GET /api/v1/catalog/products`
- `POST /api/v1/catalog/products`
- `PATCH /api/v1/catalog/products/{product_id}`
- `DELETE /api/v1/catalog/products/{product_id}` (soft deactivate)
- `CatalogView` frontend page at `/catalog`
- Category list + create/edit inline or drawer
- Product list + create/edit drawer
- i18n strings for catalog
- Tenant isolation, permission, idempotency, audit-log, and money tests
- RLS policies for categories and products tables

## Explicitly Not Allowed This Sprint

Do not implement:

- Product variants (deferred)
- Image upload (deferred)
- Product modifiers (deferred)
- Register cart or sale flow (Sprint 12)
- CSV import (deferred)
- Barcode scanning (deferred)
- Taxes / discounts (deferred)
- Deferred scope from `docs/deferred-scope.md`

## Sprint 11 Tasks

### Backend — Categories

- [ ] Add Alembic migration: `categories` table (`id`, `tenant_id`, `name`, `description`, `sort_order`, `is_active`, `created_at`, `updated_at`)
- [ ] Add RLS policy on `categories`
- [ ] Add `Category` SQLAlchemy model
- [ ] Add `categories` repository (`list_categories`, `get_category`, `create_category`, `update_category`, `deactivate_category`)
- [ ] Add `categories` service with tenant scoping, permission check, idempotency, audit log
- [ ] Add `CategoryCreate`, `CategoryUpdate`, `CategoryResponse` Pydantic schemas
- [ ] Add catalog router: `GET`, `POST`, `PATCH`, `DELETE /api/v1/catalog/categories`
- [ ] Add `catalog.create`, `catalog.update`, `catalog.delete` permissions to RBAC
- [ ] Add BDD tests: happy path, permission denied, tenant isolation, idempotency
- [ ] Add migration rollback note

### Backend — Products

- [ ] Add Alembic migration: `products` table (`id`, `tenant_id`, `category_id`, `name`, `description`, `sku`, `price_amount`, `track_inventory`, `is_active`, `created_at`, `updated_at`)
- [ ] Add RLS policy on `products`
- [ ] Add `Product` SQLAlchemy model with `category` relationship
- [ ] Add `products` repository (`list_products`, `get_product`, `create_product`, `update_product`, `deactivate_product`)
- [ ] Add `products` service with tenant scoping, permission check, idempotency, audit log, decimal money
- [ ] Add `ProductCreate`, `ProductUpdate`, `ProductResponse` Pydantic schemas
- [ ] Add catalog router extension: `GET`, `POST`, `PATCH`, `DELETE /api/v1/catalog/products`
- [ ] Add BDD tests: happy path, permission denied, tenant isolation, idempotency, money golden tests
- [ ] Add migration rollback note

### Frontend — Catalog

- [ ] Add `catalog` i18n keys to `messages.ts`
- [ ] Add `/catalog` route to `App.tsx` (protected, owner/manager only)
- [ ] Create `frontend/src/catalog/api.ts` (`listCategories`, `createCategory`, `updateCategory`, `deactivateCategory`, `listProducts`, `createProduct`, `updateProduct`, `deactivateProduct`)
- [ ] Create `frontend/src/catalog/types.ts` (`Category`, `Product`, `CategoryCreate`, `ProductCreate`, etc.)
- [ ] Create `frontend/src/catalog/CatalogView.tsx` (category sidebar + product grid)
- [ ] Add category create/edit inline form
- [ ] Add product create/edit drawer
- [ ] Add loading / empty / error states for both lists
- [ ] Add link to `/catalog` in `RegisterView` nav

## Definition of Done

- Owner can create, list, update, and deactivate categories via API.
- Owner can create, list, update, and deactivate products via API.
- Tenant B cannot read Tenant A's catalog.
- Cashier gets 403 on any catalog write.
- Prices are stored and returned as decimal strings.
- Idempotent requests replay the stored response.
- Audit logs are written for all writes.
- RLS is applied to both tables.
- `CatalogView` renders with real data or empty state.
- Loading, empty, and error states are present.
- i18n strings used throughout the UI.
- All BDD scenarios passing.
- CI green.

---

## Completed: Sprint 10 — App Shell + POS Foundation ✅

**Completed:** 2026-05-11

**What shipped:**
- `AuthContext`, `useAuth`, `RequireAuth` — full auth-aware routing
- `RootRedirect` — `/` sends authenticated users to `/register`, unauthenticated to `/login`
- Login redirects to `/register` after success
- `RegisterView` shell at `/register` with catalog + cart placeholders
- `permissions.ts` migrated from URL-param hack to role-based RBAC via AuthContext
- All protected views (`Inventory`, `Shifts`, `Reports`, `OrderDetail`, `Billing`) migrated to `usePermission` hook
- Billing moved to `/settings/billing`
- `GET /api/v1/orders` paginated endpoint with tenant scoping
- `OrderListView` with loading/empty/error states
- `seed_demo.py` — idempotent demo bakery tenant with 5 categories and 10 products
- Fly.io auto-deploy CI step on push to main
- All unit, integration, and e2e tests updated for the new auth layer

**Validated:**
- CI green (backend, frontend, smoke)
- Protected routes redirect unauthenticated users to `/login`
- Smoke tests cover auth gate, login→register flow, all protected views

---

## Completed: Sprint 9 — Billing: Standard Plan ✅

**Completed:** 2026-05-11

**What shipped:**
- Standard Plan at $199 MXN/month via Stripe Checkout
- Stripe webhook verification and idempotency
- Subscription status, grace period, and cancellation flow
- Billing UI with permission gating
- Internal admin subscription visibility endpoint
- Security hardening: CORS, secret_key validation, health endpoint, Sentry PII scrubbing
- Email verification via Resend (signup → email → click-to-verify → login)
- Fly.io auto-start configuration (`min_machines_running = 1`)

**Validated in production:**
- Stripe Checkout redirects correctly at MX$199/month
- Email verification flow works end-to-end
- `dev_verification_token` not exposed in production (`APP_ENV=production`)
- Cookies are Secure in production

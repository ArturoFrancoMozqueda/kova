# Current Sprint

## Active Sprint

Sprint: 13 - Offline Sync + Dead Letter

## Sprint Goal

Make the register work offline. Queued sales must survive connectivity loss, sync safely when the network returns, and surface unrecoverable failures in a dead-letter UI that the cashier can manually retry.

## Immediate Focus

- Dexie local sale queue with statuses: `pending`, `syncing`, `synced`, `failed`
- Sync worker with exponential backoff
- Offline indicator and pending-sale count badge
- Manual sync button
- Dead-letter UI (list failed entries, retry action)
- PWA service worker / app shell caching

## Sprint 13 Checklist

- [ ] Dexie schema for local sale queue
- [ ] Queue entry statuses: `pending`, `syncing`, `synced`, `failed`
- [ ] Register enqueues sale locally when offline (or as primary path with background sync)
- [ ] Sync worker picks up `pending` entries and calls `POST /api/v1/sync/offline-sales`
- [ ] Exponential backoff on transient failures
- [ ] `client_uuid` sent with every queued sale (idempotency key)
- [ ] Conflict / duplicate response handled: mark as `synced` without creating duplicate
- [ ] Offline indicator in app shell (badge / banner)
- [ ] Pending sync count visible to cashier
- [ ] Manual sync button triggers immediate retry of `pending` and `failed` entries
- [ ] Dead-letter UI: list `failed` entries with last error and attempt count
- [ ] Dead-letter retry: moves entry back to `pending`
- [ ] Service worker / app shell caching for offline load
- [ ] Playwright offline tests (network intercept: sale queued, then synced)
- [ ] Playwright duplicate sync test (same `client_uuid` replayed)
- [ ] Playwright dead-letter test (server returns error → entry appears in dead-letter UI)
- [ ] BDD scenarios from `specs/orders/offline_sync.feature` passing (already pass at backend layer)
- [ ] Production deployment validation for Sprint 13

## Required Specs

- `specs/orders/offline_sync.md`
- `specs/orders/dead_letter.md`
- `specs/orders/offline_sync.feature` (3 BDD scenarios — backend layer already passes)

## Backend Status

Backend sync endpoint and BDD tests already exist and pass:
- `POST /api/v1/sync/offline-sales` — idempotent by `(tenant_id, client_uuid)`
- `backend/app/tests/bdd/test_offline_sync.py` — 3 scenarios pass

Sprint 13 work is primarily **frontend**.

---

## Completed: Sprint 12 - Register Core

**Completed:** 2026-05-13

**What shipped:**
- `/register` loads active catalog products
- Cashier can add products to a cart
- Cart quantity editing, removal, total, tendered cash, and change due
- Cash, bank transfer, manual card, and split payment methods
- Register creates orders through `POST /api/v1/orders`
- Sale success links to the created order detail
- BDD coverage gap closed: `backend/app/tests/bdd/test_billing.py` (8 scenarios for `specs/billing/billing.feature`)
- E2E coverage gap closed: `frontend/e2e/shifts.spec.ts` (5 scenarios: open, open without cash, close, permission gate, error state)

**Checklist:**
- [x] Product grid connected to catalog API
- [x] Cart state and quantity editing
- [x] Cash sale UI
- [x] Bank transfer payment recording
- [x] Manual card payment recording
- [x] Split payment UI for multiple payment entries
- [x] Order create API integration
- [x] Sale success / open order handoff
- [x] Register unit coverage for cash, bank transfer, manual card, and split payment flows
- [x] Playwright E2E coverage for cash and split register sale
- [x] BDD billing coverage (billing.feature → test_billing.py, 8 scenarios)
- [x] E2E shifts coverage (shifts.spec.ts, 5 scenarios)
- [x] Offline queue and dead-letter → Sprint 13
- [x] Production deployment validation for Sprint 12

**Validation evidence:**
- `uv run --active pytest app/tests/bdd/ -v` — 63/63 passed (2026-05-13)
- `npx playwright test --reporter=list` — 21/21 passed (2026-05-13), includes new shifts.spec.ts
- Production Vercel deployment validated on 2026-05-12: `dpl_B6d9zrkPZ2gpTYTp53ubsGwrfzw6`, commit `3144974a2c7527216e8664cf39f843afb495b9ca`
- Production UI validation: cash sale order `c36820ad-325d-4b58-a251-4530f26c4f03` (total `18.50`, change `1.50`), split order `bb8927de-ec47-4512-9656-6c6d6478efe3` (`cash:10.00` + `bank_transfer:8.50`)
- Supabase audit logs confirmed `orders.create` for both production validation orders
- Auth bootstrap: `/api/v1/auth/session` returns `200` for anonymous probes, `0 errors / 0 warnings` in browser console

---

## Completed: Sprint 11 - Catalog Management

**Completed:** 2026-05-11

**What shipped:**
- Alembic-managed `categories` and `products` tables with RLS
- Catalog models, repositories, services, schemas, and `/api/v1/catalog/*` routes
- Tenant scoping, permission checks, idempotency, audit logging, and decimal-string prices
- RBAC permissions for catalog create/update/delete
- `CatalogView` at `/catalog`
- Category create/edit/deactivate UI
- Product create/edit/deactivate UI
- Loading, empty, and error states
- Register navigation entry to manage catalog
- Backend BDD and integration coverage documented in `docs/test-matrixes/catalog.md`

**Checklist:**
- [x] Category and product CRUD backend delivered
- [x] Tenant isolation rules applied
- [x] Catalog write permissions enforced
- [x] Audit logs written for catalog writes
- [x] Catalog prices serialized as decimal strings
- [x] RLS enabled on `categories` and `products`
- [x] Catalog UI renders real data and empty states
- [x] Production deploy contains Sprint 11 frontend and backend integration points

**Validation evidence:**
- Production Vercel deployment validated on commit `a2275a7e7e32d6dd0dcbcab3f38721ac2a86e813`
- Authenticated production UI validation completed for `/catalog`
- Category create, product create, product update, product deactivate, and category deactivate all succeeded from UI
- Supabase production schema exposes `categories` and `products` with RLS enabled
- Audit log recorded `catalog.category.create`, `catalog.product.create`, `catalog.product.update`, `catalog.product.deactivate`, and `catalog.category.deactivate`
- Supporting production smoke checks also covered `/register`, `/orders`, `/inventory`, `/reports`, `/shifts`, and `/settings/billing`

---

## Completed: Sprint 10 - App Shell + POS Foundation

**Completed:** 2026-05-11

**What shipped:**
- `AuthContext`, `useAuth`, `RequireAuth` - full auth-aware routing
- `RootRedirect` - `/` sends authenticated users to `/register`, unauthenticated to `/login`
- Login redirects to `/register` after success
- `RegisterView` shell at `/register` with catalog + cart placeholders
- `permissions.ts` migrated from URL-param hack to role-based RBAC via AuthContext
- All protected views (`Inventory`, `Shifts`, `Reports`, `OrderDetail`, `Billing`) migrated to `usePermission` hook
- Billing moved to `/settings/billing`
- `GET /api/v1/orders` paginated endpoint with tenant scoping
- `OrderListView` with loading/empty/error states
- `seed_demo.py` - idempotent demo bakery tenant with 5 categories and 10 products
- Fly.io auto-deploy CI step on push to main
- All unit, integration, and e2e tests updated for the new auth layer

**Validated:**
- CI green (backend, frontend, smoke)
- Protected routes redirect unauthenticated users to `/login`
- Smoke tests cover auth gate, login-to-register flow, all protected views

---

## Completed: Sprint 9 - Billing: Standard Plan

**Completed:** 2026-05-11

**What shipped:**
- Standard Plan at $199 MXN/month via Stripe Checkout
- Stripe webhook verification and idempotency
- Subscription status, grace period, and cancellation flow
- Billing UI with permission gating
- Internal admin subscription visibility endpoint
- Security hardening: CORS, secret_key validation, health endpoint, Sentry PII scrubbing
- Email verification via Resend (signup -> email -> click-to-verify -> login)
- Fly.io auto-start configuration (`min_machines_running = 1`)

**Validated in production:**
- Stripe Checkout redirects correctly at MX$199/month
- Email verification flow works end-to-end
- `dev_verification_token` not exposed in production (`APP_ENV=production`)
- Cookies are Secure in production

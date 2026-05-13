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

- [x] Dexie schema for local sale queue (`offline/db.ts`, `offline_sales` table)
- [x] Queue entry statuses: `pending`, `syncing`, `synced`, `failed`
- [x] Register enqueues sale locally then syncs immediately; clears cart regardless of result
- [x] Sync worker picks up `pending` entries and calls `POST /api/v1/sync/offline-sales`
- [x] Exponential backoff: 2s → 8s → 30s → 60s → 120s, MAX_ATTEMPTS=5
- [x] `client_uuid` sent with every queued sale (idempotency key)
- [x] Conflict / duplicate response handled: mark as `synced` without creating duplicate
- [x] Offline indicator in register header (badge: "Offline" / "N queued", link to `/sync-queue`)
- [x] Pending sync count visible to cashier via `useSyncQueue` live query
- [x] Manual sync button in `/sync-queue` view
- [x] Dead-letter UI at `/sync-queue`: lists `failed` entries with last error and attempt count
- [x] Dead-letter retry: moves entry back to `pending` and triggers immediate sync
- [x] Service worker + app shell caching via `vite-plugin-pwa` (Workbox generateSW)
- [x] Playwright offline tests: network abort → queued notice + pending section
- [x] Playwright duplicate sync test: same `client_uuid` returns same order
- [x] Playwright dead-letter test: server failure → Failed section → retry succeeds
- [x] BDD scenarios from `specs/orders/offline_sync.feature` passing (backend layer)
- [ ] Production deployment validation for Sprint 13

**Validation evidence (2026-05-13):**
- `npm run build` — clean, generates `dist/sw.js` + `dist/workbox-*.js` + `dist/manifest.webmanifest`
- `npx tsc --noEmit` — no errors
- `npm run lint` — no errors
- `npm test -- --run` — 10/10 unit tests pass
- `npx playwright test` — 26/26 E2E pass (includes 4 offline-sync + 3 register-sale offline)

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

# Current Sprint

## Active Sprint

Sprint: 15 - Modifiers

## Sprint Goal

Add modifier groups to products so restaurants and bakeries can configure options (size, extras, toppings). Extend the pricing calculator, register UI, and receipts to support required/optional modifiers with min/max selection.

## Immediate Focus

- `modifier_groups` and `modifier_options` tables with RLS and tenant scoping
- Product ↔ modifier group association
- Modifier selection in the register cart
- Pricing calculator extended for modifier pricing
- Order items store selected modifiers
- Receipt shows selected modifiers per line

## Sprint 15 Checklist

- [x] Feature spec: `specs/catalog/modifiers.md`
- [x] BDD scenarios: `specs/catalog/modifiers.feature`
- [x] `modifier_groups` table (name, required, min_selections, max_selections)
- [x] `modifier_options` table (name, price_delta)
- [x] `product_modifier_groups` join table
- [x] `order_item_modifiers` table (records selected options per order item)
- [x] Alembic migration
- [x] RLS policies for modifier tables
- [x] CRUD endpoints for modifier groups + options
- [x] Product create/edit UI: assign modifier groups
- [x] Register cart: show modifier selection modal on add-to-cart
- [x] Pricing calculator: sum option price_deltas onto base price
- [x] Order creation: persist selected modifiers
- [x] Receipt: render selected modifiers per line item
- [x] Backend BDD scenarios pass
- [x] Frontend E2E scenarios pass
- [x] Production deployment validation

## Sprint 15 Validation Notes

- Production repair completed on 2026-05-13 after the deployed frontend reached modifier endpoints before the production database had the Sprint 15 modifier tables.
- Supabase production was brought forward to `0015_modifier_price_precision`, including the missing modifier tables, tenant-scoped RLS policies, and aligned decimal precision.
- Production frontend validation completed on `https://point-of-sale-ochre.vercel.app/` for authenticated `/register`, `/catalog`, and `/orders`.
- Latest validated Vercel production deployment: `dpl_CF1MMnu8UbdjfNgJTNWAvGQVJmgK`.
- Deployment housekeeping note: an extra temporary Vercel project named `frontend` was created during an initial CLI deploy attempt before the repo was relinked to the real `point-of-sale` project. Review and delete that stray project from Vercel admin when convenient.
- Test hygiene note: the `modifiers` pytest marker was registered on 2026-05-13, and the backend modifier BDD suite now passes without that warning.

---

## Pre-Beta Ops Checklist (required before first beta tenant — not blocking Sprint 15)

These tasks require production/external tool access. Complete them before onboarding Tenant 1.

- [ ] **Sentry:** Set `SENTRY_DSN` in Fly.io secrets + `VITE_SENTRY_DSN` in Vercel. Create alert rules (new issue → email, error spike > 10/5min → email). Guide: `specs/ops/monitoring.md`
- [ ] **Backups drill:** Confirm Supabase daily backups active. Restore to temp project, run migrations, smoke test. Document result. Guide: `specs/ops/backups.md`
  - 2026-05-14 check: blocked because Supabase organization `PoS` is currently on the Free plan, so daily managed backups are not confirmed active. Evidence and next steps documented in `docs/backup-restore-drill-2026-05-14.md`.
- [ ] **Uptime monitor:** Add UptimeRobot free monitor on `https://pos-project-backend.fly.dev/health`. Set email alert. 10 min.
- [ ] **Support channel:** Create `beta@yourdomain.com` (or WhatsApp group). Test that messages reach you. Guide: `specs/support/beta_support.md`
- [x] **Beta agreement template:** Create `docs/beta-agreement-template.md`. Guide: `specs/support/beta_support.md`
- [x] **Production deployment Sprint 14:** Deploy backend + frontend, verify security headers in live production response headers.
- [x] **Verify secure cookies in production:** Confirm `Secure; HttpOnly; SameSite=Lax` on auth cookies after deploy.

---

## Completed: Sprint 14 - Beta Hardening (code)

**Completed:** 2026-05-13 (code); ops checklist above pending manual steps

**What shipped:**
- `app/middleware/security_headers.py` — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `HSTS` (production only)
- `app/middleware/rate_limit.py` — `_FixedWindowLimiter` thread-safe, `rate_limit(n)` dependency factory
- Auth router: login 20/min, signup 10/min, password-reset 5/min (per IP via `X-Forwarded-For`)
- `vercel.json` — full CSP, HSTS, X-Frame-Options, Permissions-Policy for frontend
- `app/tests/test_security.py` — 6 tests: headers, HSTS absent in local, 429 per endpoint, rate limit per IP
- 5 spec files: `specs/security/rate_limit.md`, `specs/security/headers.md`, `specs/ops/backups.md`, `specs/ops/monitoring.md`, `specs/support/beta_support.md`
- `npm audit`: 5 moderate in devDependencies only, no production vulnerabilities

**Required Specs:**
- `specs/security/rate_limit.md` ✅
- `specs/security/headers.md` ✅
- `specs/ops/backups.md` ✅
- `specs/ops/monitoring.md` ✅
- `specs/support/beta_support.md` ✅

---

## Completed: Sprint 13 - Offline Sync + Dead Letter

**Completed:** 2026-05-13

**What shipped:**
- Dexie `offline_sales` queue with statuses `pending`, `syncing`, `synced`, `failed`
- Sync worker (`offline/syncWorker.ts`) with exponential backoff (2s → 120s), MAX_ATTEMPTS=5, `online` event auto-retry
- Register uses `queueOfflineSale` + `syncOfflineSales`; cart clears as soon as sale is persisted locally
- `syncOfflineSales` returns `SyncItemResult[]` with the order object; re-throws on network errors
- `OfflineIndicator` in register header: "Offline" badge / "N queued" badge with link to `/sync-queue`
- `SyncQueueView` at `/sync-queue`: pending section + failed (dead letter) section with retry + "Sync now" button
- `vite-plugin-pwa` Workbox generateSW: precaches app shell assets; API routes are `NetworkOnly`
- `registerSW({ immediate: true })` in `main.tsx` for auto-update
- SVG placeholder icons in `public/icons/` (replace with real PNGs before beta GA)

**Checklist:**
- [x] All items complete except production deployment validation

**Validation evidence (2026-05-13):**
- `npm run build` — `dist/sw.js` + `dist/workbox-*.js` + `dist/manifest.webmanifest` generated
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test -- --run` — 10/10 unit tests
- `npx playwright test` — 26/26 E2E (4 offline-sync, 3 register-sale, 5 shifts, others)

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

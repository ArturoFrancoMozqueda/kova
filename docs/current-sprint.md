# Current Sprint

## Active Sprint

Sprint: 12 - Register Core

## Sprint Goal

Turn the authenticated register shell into the first complete sale flow: show sellable catalog items, build a cart, record supported beta payment methods, create the order safely, and hand off a receipt-ready result.

## Immediate Focus

- Real product grid in `/register`
- Cart quantity editing and totals
- Cash payment and manual transfer/card recording
- Order creation through the existing backend invariants
- Register loading, empty, error, and permission states
- UI validation against the beta north star flow

## Sprint 12 Progress

**Implemented so far:**
- `/register` loads active catalog products
- Cashier can add products to a cart
- Cart quantity editing, removal, total, tendered cash, and change due are visible
- Cash, bank transfer, manual card, and split payment methods are supported
- Register creates orders through `POST /api/v1/orders`
- Sale success links to the created order detail
- Local Vite proxy points `/api` to the Docker backend for real local validation

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
- [ ] Offline queue and dead-letter handoff to Sprint 13
- [ ] Tablet/mobile register polish
- [x] Production deployment validation for Sprint 12

**Validation evidence:**
- `npm run lint`
- `npm test -- --run src/__tests__/App.test.tsx` - 6 tests passed
- `npm run build`
- `npm run test:e2e -- --grep "cashier completes.*register|cashier completes a split"` - 2 tests passed
- Local Docker-backed UI validation completed for signup, email verification, login redirect, catalog product creation, cash sale, order detail, and receipt values
- Backend split payment test execution attempted with `uv run pytest app/tests/test_split_payment.py app/tests/bdd/test_split_payment.py`; blocked locally by Windows virtualenv/dependency setup (`resend` missing in `.venv-win`)
- Production Vercel deployment validated on 2026-05-12: `dpl_B6d9zrkPZ2gpTYTp53ubsGwrfzw6`, commit `3144974a2c7527216e8664cf39f843afb495b9ca`
- Production UI validation completed for login, catalog product creation, cash sale, split cash + bank transfer sale, order detail, and receipt rendering
- Production cash order `c36820ad-325d-4b58-a251-4530f26c4f03`: total `18.50`, payment `cash:18.50`, receipt tendered `20.00`, change `1.50`
- Production split order `bb8927de-ec47-4512-9656-6c6d6478efe3`: total `18.50`, payments `cash:10.00` and `bank_transfer:8.50`
- Supabase production audit logs confirmed `orders.create` for both production validation orders
- Auth bootstrap cleanup validated in production on 2026-05-12: frontend deployment `dpl_6M7B6q9afRzpmmkBUkZRK7ZpcYbw`, commit `d2ef4dfa3594ffe91e4ae08ffd273b32de59bbb9`
- `/api/v1/auth/session` now returns `200` for anonymous probes, login still lands on `/register`, and browser console stayed at `0 errors / 0 warnings`

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

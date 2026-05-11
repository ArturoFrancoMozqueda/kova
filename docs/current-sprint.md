# Current Sprint

## Active Sprint

Sprint: 10 - App Shell + POS Foundation

## Sprint Goal

Turn the deployed app from a module laboratory into a sellable product shell: authenticated navigation, a real POS register screen, and the email verification flow needed for real tenant onboarding.

## Required Specs

- `specs/auth/app_shell.feature`
- `specs/register/pos_shell.feature`

## Required BDD / Test Scenarios

- Unauthenticated user is redirected to /login when accessing any protected route.
- Authenticated user lands on /register after login.
- Authenticated user can log out and is redirected to /login.
- Cashier cannot access /settings/billing.
- Tenant owner can access /settings/billing.

## Allowed Work

Only work on:

- AuthContext and useAuth hook (session management via getMe())
- RequireAuth component gating all protected routes
- Redirect / → /register if authenticated, /login if not
- Redirect to /register after successful login
- Move billing to /settings/billing
- Remove demo ?permissions= links from Home
- Basic RegisterView shell at /register
- GET /api/v1/orders list endpoint (backend + frontend)
- Seed script for demo tenant + bakery catalog
- CI deploy step for Fly.io (auto-deploy on push to main)

## Explicitly Not Allowed This Sprint

Do not implement:

- Full POS cart/payment flow (Sprint 11)
- Refunds/voids UI improvements
- Multi-location
- Advanced reporting
- Deferred scope from `docs/deferred-scope.md`

## Sprint 10 Tasks

### Auth Gate

- [ ] Create `frontend/src/auth/AuthContext.tsx` with `user`, `tenant`, `loading`, `logout()`
- [ ] Create `frontend/src/auth/useAuth.ts` hook
- [ ] Add `RequireAuth` component to `App.tsx`
- [ ] Update `AuthView.tsx` to redirect to `/register` after login
- [ ] Update `auth/permissions.ts` — remove localStorage, read role from AuthContext
- [ ] Add `/` → redirect to `/register` if session, `/login` if not

### App Shell

- [ ] Create `frontend/src/register/RegisterView.tsx` (basic shell, catalog + cart placeholder)
- [ ] Add `/register` route to `App.tsx`
- [ ] Move billing to `/settings/billing`
- [ ] Hide billing link from cashier role
- [ ] Clean up `Home.tsx` — remove all `?permissions=...` demo links

### Orders

- [ ] Add `GET /api/v1/orders` backend endpoint with pagination and tenant scoping
- [ ] Add `list_orders_by_tenant()` to `backend/app/orders/repository.py`
- [ ] Add `OrderListItem` and `OrderListResponse` schemas
- [ ] Create `frontend/src/orders/OrderListView.tsx`
- [ ] Add `listOrders()` to `frontend/src/orders/api.ts`

### Onboarding

- [ ] Create `backend/scripts/seed_demo.py` (demo tenant + 5 bakery categories + 10 products)

### CI

- [ ] Add `fly deploy` step to `.github/workflows/ci.yml` on push to main

## Definition of Done

- Unauthenticated users cannot access protected routes.
- Login redirects to /register.
- Logout clears session and redirects to /login.
- /register exists and shows a basic POS shell.
- /settings/billing works; cashier sees 403/hidden.
- Order list renders with real data or empty state.
- Seed script creates a usable demo catalog.
- Auto-deploy to Fly on push to main.
- Quality gates pass.

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

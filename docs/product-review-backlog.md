# Product Review Backlog

Last updated: 2026-05-17

## Purpose

This backlog converts the production review of `https://point-of-sale-ochre.vercel.app/` into
spec-driven, reviewable sprints.

These sprints should be completed before selling to cold customers. They can be run before the
planned tax and discount work, because they address trust, billing, onboarding, and production
readiness issues found in the live product.

## Review Summary

Production has a credible POS core: landing, login, catalog, register, cash sale, receipt, reports,
audit logs, Vercel deployment, and Supabase tenant-scoped tables are all present.

The app is not yet sellable without founder assistance because:

- Returning browsers can see stale UI through the PWA/service worker.
- Production CSP blocks Google Fonts.
- Pricing copy is inconsistent: dashboard says 299 MXN/month while billing and Stripe say 199 MXN/month.
- Stripe Checkout is intentionally still in sandbox/test mode until the app is ready for paid beta.
- Subscription access rules are not enforced clearly.
- Signup, onboarding, employee setup, business settings, and inventory activation are incomplete.
- Mobile orders layout overflows at phone width.
- Supabase has schema and RLS findings that need documented decisions or fixes before beta.

## Sprint PB-1 - Production Trust Repair

### Goal

Make production behave consistently, remove buyer-trust breakers, and ensure the public path can
support a real paid beta subscription.

### Required Specs

- Update `specs/billing/standard_plan.md`
- Update `specs/billing/checkout.md`
- Update `specs/security/headers.md`
- Create `specs/ops/pwa_release_updates.md`
- Create `specs/ops/production_smoke.md`

### Required BDD / E2E Scenarios

- Returning browser receives the newest landing/app shell after deployment.
- Standard Plan price is 199 MXN/month everywhere.
- Production checkout opens the expected Stripe mode: sandbox before launch, live before paid beta.
- Unsubscribed tenant sees correct trial or billing state.
- CSP allows required production assets and produces zero console errors on landing/login/dashboard.

### Tasks

- [x] Write `specs/ops/pwa_release_updates.md` with service worker update behavior, cache rules, and rollback behavior.
- [x] Add BDD/E2E coverage for stale app shell prevention.
- [x] Review `vite-plugin-pwa` config for `skipWaiting`, `clientsClaim`, app shell precache, and update prompt behavior.
- [x] Add a visible update prompt or forced refresh strategy for breaking UI deploys.
- [x] Fix CSP to either self-host fonts or allow `fonts.googleapis.com` and `fonts.gstatic.com`.
- [x] Create one source of truth for Standard Plan amount and copy.
- [x] Replace all 299 MXN references with 199 MXN unless explicitly test-only.
- [ ] Configure live Stripe keys, live price, and live webhook endpoint before paid beta.
- [x] Add production runtime guard that rejects Stripe test keys and test Checkout Sessions unless sandbox mode is explicitly enabled.
- [x] Add environment validation that fails startup/build if production uses Stripe test keys unless sandbox mode is explicitly enabled.
- [x] Add production smoke test for landing, login, dashboard, billing, checkout redirect, and console errors.
- [ ] Clean up the stray Vercel `frontend` project after confirming it is unused.
- [x] Update `docs/risk-register.md` with PWA stale release and billing-mode risks.

### Acceptance Criteria

- Fresh and returning browsers show the same current landing after deploy.
- Browser console has zero CSP/font errors on `/`, `/login`, `/dashboard`, and `/settings/billing`.
- Landing, dashboard, billing UI, API response, and Stripe Checkout all show 199 MXN/month.
- Stripe Checkout URL matches the expected phase: sandbox while pre-launch, live before paid beta.
- A production smoke checklist can be run after every deploy.

### Validation Notes

- 2026-05-17: `npm run test:production-smoke` against
  `https://point-of-sale-ochre.vercel.app` passed landing/login/dashboard/billing price checks and
  register sale/receipt/report checks.
- 2026-05-17: Production smoke confirmed Stripe redirected to `checkout.stripe.com` with a `cs_test`
  session id. This is accepted for pre-launch sandbox mode. Live Stripe configuration remains a
  paid-beta release gate, not a current development blocker.
- 2026-05-17: `npx playwright test e2e/app-shell.spec.ts --project=chromium` passed the app-shell
  stale update prompt scenario, including visible notice, dismiss, and apply-update event.

## Sprint PB-2 - Signup, Onboarding, and Business Setup

### Goal

A new bakery or small food retail tenant can sign up, understand setup status, configure the minimum
business profile, and reach first sale without engineering assistance.

### Required Specs

- Update `specs/onboarding/premium_saas_experience.md`
- Create `specs/onboarding/first_sale.md`
- Create `specs/settings/business_profile.md`
- Create `specs/settings/receipt_settings.md`
- Update `specs/settings/logo.md`

### Required BDD / E2E Scenarios

- New tenant signs up and lands on a setup checklist.
- New tenant configures business profile and receipt details.
- New tenant creates first product and sees checklist progress update.
- New tenant completes first sale and checklist marks first sale complete.
- Signup, login, onboarding, and setup copy are localized consistently.

### Tasks

- [x] Write `specs/onboarding/first_sale.md`.
- [x] Write `specs/onboarding/first_sale.feature`.
- [x] Create `docs/test-matrixes/onboarding.md`.
- [ ] Add tenant onboarding state model with tenant-scoped RLS.
- [ ] Add API endpoints for onboarding state read/update.
- [ ] Add dashboard checklist steps: business profile, first product, inventory optional, open shift, first sale, billing.
- [ ] Make each checklist step link to the exact action, not just the module.
- [ ] Add business profile settings: public business name, support phone/email, timezone, locale, currency display.
- [ ] Add receipt settings: receipt business name, footer, tax/contact text placeholder, logo hook.
- [x] Replace signup copy "Start accepting payments in minutes" with POS-accurate copy.
- [x] Move remaining signup/login/app-shell copy into i18n.
- [ ] Add loading, empty, and error states for onboarding settings.
- [ ] Add E2E new-tenant onboarding happy path.

### Acceptance Criteria

- A new tenant can identify the next setup action within 5 seconds of first login.
- Business and receipt settings persist per tenant.
- Onboarding progress is tenant-scoped and audited.
- No signup/login/onboarding UI mixes English and Spanish copy unintentionally.

## Sprint PB-3 - Commercial Access Control

### Goal

Make the commercial model enforceable without creating pricing tiers.

### Required Specs

- Update `specs/billing/standard_plan.md`
- Update `specs/billing/past_due.md`
- Create `specs/billing/trial_access.md`
- Create `specs/billing/access_control.md`

### Required BDD / E2E Scenarios

- Tenant with no subscription sees trial or billing banner.
- Tenant in active trial can use core POS.
- Tenant past trial without active subscription is blocked from register sale creation.
- Tenant with active subscription can use all current features.
- Owner can resume billing from blocked state.

### Tasks

- [x] Define trial rules: duration, start trigger, grace behavior, and owner-visible copy.
- [x] Add subscription access service used by protected business flows.
- [x] Gate write-heavy paid flows after trial/grace: orders, catalog writes, inventory adjustments, shifts.
- [x] Keep read-only access to receipts, billing, and support while blocked.
- [x] Add clear billing banner on dashboard/register when unpaid, trialing, past_due, canceled, or blocked.
- [x] Add backend tests for subscription access states.
- [x] Add E2E coverage for blocked and active subscription states.
- [x] Add audit log event for billing access block if a blocked write is attempted.

### Acceptance Criteria

- The app cannot be used indefinitely with no subscription unless explicitly in trial/grace.
- Blocked users receive a clear recovery path to billing.
- No Basic/Pro/Premium or feature-tier logic is introduced.

## Sprint PB-4 - Core Operations Completion

### Goal

Close the biggest operational gaps in the beta north-star flow: employee setup, inventory activation,
mobile order review, and shift-first POS guidance.

### Required Specs

- Update `specs/settings/employees.md`
- Create `specs/inventory/activation.md`
- Create `specs/orders/mobile_order_list.md`
- Create `specs/shifts/register_shift_gate.md`

### Required BDD / E2E Scenarios

- Owner invites an employee and assigns a role.
- Cashier cannot access owner-only settings.
- Owner activates inventory tracking for a product and sees it in inventory.
- Mobile orders page has no horizontal overflow at 390 px.
- Register warns or gates sale when no shift is open, according to the spec decision.

### Tasks

- [ ] Define whether employees are modeled as `memberships` only or a separate employee profile table.
- [ ] Add employee invite/list/deactivate UI.
- [ ] Add employee role management for owner/manager/cashier using existing RBAC constants.
- [ ] Add inventory activation path from Inventory empty state to product edit.
- [ ] Add inline product inventory controls: track inventory, current stock, low-stock threshold.
- [ ] Add inventory movement history panel for tracked products if API already supports it.
- [ ] Convert mobile orders table to cards below small breakpoint.
- [ ] Add mobile viewport tests for orders, register, dashboard, and billing at 390 px.
- [ ] Decide shift gate behavior: hard block sales, soft warning, or checklist-only.
- [ ] Implement chosen shift behavior consistently in register and dashboard.

### Acceptance Criteria

- Owner can create and manage real cashier access without direct database work.
- Inventory is discoverable from empty state and useful after one setup action.
- Orders page has no horizontal overflow on phone widths.
- Register behavior around open shifts is explicit and tested.

## Sprint PB-5 - Data Integrity and Tenant Isolation Hardening

### Goal

Resolve or document Supabase schema findings before onboarding real tenants.

### Required Specs

- Update `specs/shared/tenant_isolation.md`
- Update `specs/shared/authz.md`
- Update `specs/catalog/modifiers.md`
- Create `specs/shared/database_integrity.md`

### Required BDD / Integration Scenarios

- Tenant A cannot read or mutate Tenant B catalog, orders, inventory, shifts, subscriptions, modifiers, or audit logs.
- Cross-tenant modifier group assignment is rejected.
- Orphan modifier options and order item modifiers cannot be created.
- Audit logs do not expose another tenant's data.
- Direct guessed-ID access returns 403 or 404.

### Tasks

- [ ] Review all RLS-enabled tables with no policy and document whether backend-only access is intentional.
- [ ] Add policies or explicit ADR for `tenants`, `users`, `roles`, `permissions`, `role_permissions`, and `verification_tokens`.
- [ ] Review whether `audit_logs.tenant_id IS NULL` should be visible to all tenant contexts.
- [ ] Add or confirm foreign keys for `modifier_options.group_id`.
- [ ] Add or confirm foreign keys for `product_modifier_groups.product_id` and `modifier_group_id`.
- [ ] Add or confirm foreign keys for `order_item_modifiers.order_item_id`, `modifier_group_id`, and `modifier_option_id`.
- [ ] Decide whether `product_modifier_groups` needs `tenant_id`; add it unless ADR documents the join-policy exception.
- [ ] Add covering indexes for important foreign keys used in tenant-scoped queries.
- [ ] Optimize RLS policies flagged by Supabase advisor by wrapping `current_setting()` in select where appropriate.
- [ ] Add tenant isolation tests for every tenant-scoped route.

### Acceptance Criteria

- Every tenant-scoped table either has `tenant_id` or a documented exception.
- Modifier schema prevents orphan and cross-tenant data by database constraints, not only app code.
- Supabase advisor findings are either fixed or documented with accepted risk.

## Sprint PB-6 - Analytics Credibility and Reporting v1 Polish

### Goal

Make analytics trustworthy and useful for owners without inventing data.

### Required Specs

- Update `specs/reports/range.md`
- Update `specs/reports/payment_breakdown.md`
- Update `specs/reports/top_products.md`
- Create `specs/marketing/landing_metrics.md`

### Required BDD / E2E Scenarios

- Reports show only real backend data for selected date range.
- Empty reports explain why there is no data and how to create the first sale.
- Landing does not show unverifiable customer or processed-volume claims unless backed by real source.
- Dashboard today/yesterday comparison handles zero previous sales.

### Tasks

- [ ] Replace fake-looking landing metrics or label them clearly as illustrative.
- [ ] Add dashboard trend comparison using real report endpoints.
- [ ] Add report empty states with actions to register/catalog.
- [ ] Add export decision: defer CSV or add minimal CSV for orders/reports.
- [ ] Add report filters QA for date ranges and timezone boundaries.
- [ ] Add money golden tests for report aggregation after refunds/voids.

### Acceptance Criteria

- A business owner can understand today, payment mix, and top products from real data.
- No marketing claim implies traction or processed volume that is not backed by production data.

## Suggested Execution Order

1. Sprint PB-1 - Production Trust Repair
2. Sprint PB-3 - Commercial Access Control
3. Sprint PB-2 - Signup, Onboarding, and Business Setup
4. Sprint PB-5 - Data Integrity and Tenant Isolation Hardening
5. Sprint PB-4 - Core Operations Completion
6. Sprint PB-6 - Analytics Credibility and Reporting v1 Polish

Tax, discounts, retail preset, and restaurant preset should resume after PB-1 through PB-5 are done,
unless a beta tenant has a signed need that changes the order.

## Release Gates Before Selling

- Production Stripe is live and webhook-backed.
- Standard Plan price is consistent everywhere.
- PWA stale app shell issue is fixed and tested.
- No production console errors on core routes.
- Tenant isolation tests pass.
- New tenant onboarding path passes E2E.
- Subscription access behavior is explicit and tested.
- Owner can set up catalog, employee, inventory tracking, shift, sale, receipt, and report without database work.

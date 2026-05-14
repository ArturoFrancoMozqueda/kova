# Sprint Planning: Customizable Multi-Tenant POS Platform

## Status

**Current:** Sprint 15 (Modifiers) complete. Pre-beta ops checklist partially done. Sprint 16 is the next execution target.

**Last updated:** 2026-05-14

This document defines the roadmap and task structure.

Permanent rules live in `CLAUDE.md`.

Active scope lives in `docs/current-sprint.md`.

Deferred scope lives in `docs/deferred-scope.md`.

Risks live in `docs/risk-register.md`.

## Executive Summary

We are building a customizable multi-tenant POS SaaS platform based on Sweet Home POS MVP learnings.

The initial target is a sellable closed beta for bakery / small food retail.

The product should be:

- multi-tenant from day one
- offline-first
- secure by default
- BDD/spec-driven
- modular monolith
- simple to sell
- simple to operate
- production-ready enough for paid beta tenants

The first monetization model is intentionally simple:

- Standard Plan
- $199 MXN/month
- all currently available features included
- no Basic / Pro / Premium tiers
- no plan-based feature gates for v1

## North Star Flow

tenant signup → business setup → catalog setup → open shift → create sale → accept payment → issue receipt → offline sync if needed → close shift → review daily sales → maintain active subscription

## Phase Plan

| Phase | Sprints | Status | Outcome |
|---|---|---|---|
| Foundation | 0A–0C | ✅ Done | Repo, app skeleton, auth, tenant isolation, BDD harness |
| Operations | 5–8 | ✅ Done | Refunds, voids, receipts, shifts, inventory, reporting |
| Billing + App Shell | 9–10 | ✅ Done | $199 MXN plan, Stripe Billing, auth-protected routing, register shell |
| Core POS | 11–13 | ✅ Done | Catalog, register, cash/manual sale, order creation, offline sync |
| Beta Hardening | 14 | ✅ Code done — ops pending | Security, monitoring, backup drill, beta support |
| Modifiers | 15 | ✅ Done | Modifier groups, options, pricing, register modal, receipts |
| UX Polish + Onboarding | 16 | 🔄 In progress | Mobile sidebar, category names, payment picker, card rec stub (done); onboarding, orders filter, stock badges TBD |
| Tax Engine | 17 | 📋 Planned | Tax rates, tax-inclusive/exclusive, receipt line tax |
| Discounts | 18 | 📋 Planned | Per-line and per-order discounts, reason tracking |
| Card Recommendation v1 | 19 | 📋 Planned | Card management, benefit rules, checkout recommendation engine |
| Retail Preset + Adv. Inventory | 20 | 📋 Planned | Retail preset, barcode/SKU input, CSV import, stock history |
| Restaurant Preset | 21 | 📋 Planned | Restaurant catalog preset, table notes, modifier-heavy menus |
| GA Hardening | 22 | 📋 Planned | Legal, marketing site, help center, security + load review, accessibility |
| Closed Beta | — | 🔜 After Sprint 16 + ops | 3 friendly tenants, $199 MXN/month |

### Core POS Sprint Breakdown

| Sprint | Focus | Status |
|---|---|---|
| 11 | Catalog Management — categories + products CRUD, BDD, RLS | ✅ Done |
| 12 | Register Core — product grid, cart, cash/manual/split payment, order creation | ✅ Done |
| 13 | Offline Sync + Dead Letter | ✅ Done |

### Sprint 15 Update

- Modifiers are implemented, tested, production-deployed, and documented as of 2026-05-13.
- Production mismatch found during validation was repaired in Supabase and redeployed through Vercel.
- The immediate remaining execution path is the pre-beta ops checklist in `docs/current-sprint.md`, not more modifier feature work.

## BDD Coverage Matrix

| Domain | Happy Path | Permission Denied | Tenant Isolation | Idempotency | Offline / Sync | Money Rounding | Concurrency | Audit Log | i18n / Locale |
|---|---|---|---|---|---|---|---|---|---|
| Auth & Sessions | Beta | Beta | Beta | n/a | n/a | n/a | GA | Beta | GA |
| Catalog | Beta | Beta | Beta | Beta | n/a | n/a | GA | Beta | GA |
| Register / Cart | Beta | Beta | Beta | n/a | Beta | Beta | n/a | n/a | Beta |
| Order Creation | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Cash Payment | Beta | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Manual Transfer/Card | Beta | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Split Payment | Beta if included | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta |
| Refund / Void | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Inventory | Beta | Beta | Beta | Beta | Beta | n/a | Beta | Beta | n/a |
| Shifts | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta | Beta |
| Receipts | Beta | n/a | Beta | n/a | Beta | Beta | n/a | n/a | Beta |
| Reporting | Beta | Beta | Beta | n/a | n/a | Beta | n/a | n/a | Beta |
| Billing | Beta | Beta | Beta | Beta | n/a | Beta | n/a | Beta | Beta |
| Modifiers | GA | GA | GA | GA | GA | GA | GA | GA | GA |
| Tax Engine | GA | GA | GA | n/a | n/a | GA | n/a | GA | GA |
| Discounts | GA | GA | GA | n/a | GA | GA | n/a | GA | GA |

## Test Matrix Template

Each feature spec should include this table:

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| ORDER-001 | specs/orders/cash_sale.feature | Cashier completes a cash sale | E2E | frontend/tests/features/cash_sale.feature | @p0 @money | Beta | Required | |
| ORDER-002 | specs/orders/cash_sale.feature | Change is computed correctly | Unit | backend/tests/unit/test_pricing.py | @money | Beta | Required | |
| ORDER-003 | specs/shared/idempotency.feature | Same key returns same response | Backend BDD | backend/tests/features/idempotency.feature | @idempotency | Beta | Required | |

## Sprint 0A — Platform Skeleton

### Goal

Create the minimum deployable application skeleton.

### Product Outcome

A user can open the app shell and see a basic landing/login placeholder.

### Technical Outcome

Local dev, backend skeleton, frontend skeleton, database, migrations, basic CI, and staging path exist.

### Required Specs

- `specs/shared/project_skeleton.md`
- `specs/shared/local_dev.md`

### Required Scenarios

- App health check responds successfully.
- Frontend loads app shell.
- Backend connects to database.
- Alembic migration applies cleanly.
- CI runs backend tests.
- CI runs frontend checks.

### Tasks

- [ ] Create monorepo structure.
- [ ] Add backend FastAPI skeleton.
- [ ] Add frontend React/TypeScript skeleton.
- [ ] Add PostgreSQL local dev setup.
- [ ] Add Docker Compose.
- [ ] Add Alembic.
- [ ] Add initial migration.
- [ ] Add `/health` endpoint.
- [ ] Add backend test framework.
- [ ] Add frontend test framework.
- [ ] Add GitHub Actions CI.
- [ ] Add lint/typecheck/test commands.
- [ ] Add `.env.example`.
- [ ] Ensure `.env` is ignored.
- [ ] Add documented staging deployment path.
- [ ] Add README local dev instructions.

### Data Model

- Initial Alembic setup only.

### API

- `GET /health`
- Optional `GET /api/v1/version`

### UI

- App shell.
- Basic error boundary placeholder.

### Tests

- Backend health test.
- Frontend smoke test.
- Migration apply test.

### Definition of Done

- App runs locally.
- Backend tests pass.
- Frontend checks pass.
- Migration applies.
- CI runs on PR.
- No secrets are committed.

## Sprint 0B — Security + Multi-Tenant Foundation

### Goal

Establish tenant isolation, auth foundation, sessions, RBAC skeleton, audit logs, and idempotency infrastructure.

### Product Outcome

A tenant owner can sign up, verify email, log in, refresh session, log out, and see tenant-specific shell data.

### Required Specs

- `specs/auth/sessions.md`
- `specs/shared/tenant_isolation.md`
- `specs/shared/authz.md`
- `specs/shared/audit_log.md`
- `specs/shared/idempotency.md`

### Tasks

- [ ] Create `tenants` table.
- [ ] Create `users` table.
- [ ] Create `memberships` table.
- [ ] Create `roles` table.
- [ ] Create `permissions` table.
- [ ] Create `role_permissions` table.
- [ ] Create `sessions` table.
- [ ] Create `audit_logs` table.
- [ ] Create `idempotency_keys` table.
- [ ] Add RLS policies where applicable.
- [ ] Add tenant context middleware.
- [ ] Add signup endpoint.
- [ ] Add email verification endpoint.
- [ ] Add login endpoint.
- [ ] Add refresh endpoint.
- [ ] Add logout endpoint.
- [ ] Add logout-all endpoint.
- [ ] Add password reset endpoints.
- [ ] Add password hashing.
- [ ] Add refresh token/session rotation.
- [ ] Add session revocation.
- [ ] Add RBAC skeleton.
- [ ] Add permission dependency.
- [ ] Add write invariant helper/decorator.
- [ ] Add audit log helper.
- [ ] Add idempotency helper.
- [ ] Add tenant isolation tests.
- [ ] Add permission denied tests.
- [ ] Add auth/session tests.

### API

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/verify`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `GET /api/v1/me`

### Definition of Done

- Auth flows work.
- Tenant isolation tests pass.
- Session revocation works.
- Demo write endpoint proves idempotency/audit/permission/tenant invariants.

## Sprint 0C — Quality + BDD Foundation

### Goal

Create the spec-driven delivery system before implementing core POS features.

### Tasks

- [ ] Add `/specs` structure.
- [ ] Add `/docs/test-matrixes` structure.
- [ ] Add BDD test tooling.
- [ ] Add backend BDD runner.
- [ ] Add frontend E2E runner.
- [ ] Add shared scenario convention.
- [ ] Add PR template.
- [ ] Add test matrix template.
- [ ] Add structured JSON logging.
- [ ] Add request_id middleware.
- [ ] Add Sentry frontend/backend.
- [ ] Add OpenAPI generation.
- [ ] Add pre-commit hooks.
- [ ] Add no-secrets check.
- [ ] Add no raw `print`/`console.log` rule where feasible.
- [ ] Add no-floats-in-money rule placeholder.

### Definition of Done

- Backend BDD works.
- Frontend E2E works.
- PR template exists.
- Test matrix template exists.
- CI runs quality gates.
- Logs include request_id.
- Sentry receives test error if configured.

## Sprint 1 — Catalog Foundation

### Goal

Allow a tenant owner to create the basic catalog needed to sell.

### Required Specs

- `specs/catalog/categories.md`
- `specs/catalog/products.md`
- `specs/catalog/variants.md`

### Tasks

- [ ] Create categories table.
- [ ] Create products table.
- [ ] Create product_variants table if needed.
- [ ] Create product_images table or image URL fields.
- [ ] Add RLS policies.
- [ ] Add catalog service.
- [ ] Add catalog repository.
- [ ] Add catalog router.
- [ ] Add catalog schemas.
- [ ] Add catalog policies.
- [ ] Add category CRUD.
- [ ] Add product CRUD.
- [ ] Add product soft-delete.
- [ ] Add variant support if needed.
- [ ] Add image upload flow if included.
- [ ] Add catalog page.
- [ ] Add category management UI.
- [ ] Add product list UI.
- [ ] Add product create/edit drawer.
- [ ] Add audit logging.
- [ ] Add idempotency for writes.
- [ ] Add tenant isolation tests.
- [ ] Add permission tests.
- [ ] Add E2E create/edit/deactivate product.

## Sprint 2 — Register + Online Sale

### Goal

A cashier can complete an online sale with cash/manual payment.

### Required Specs

- `specs/orders/cash_sale.md`
- `specs/orders/manual_payment.md`
- `specs/inventory/decrement.md`
- `specs/pricing/money_rules.md`

### Tasks

- [ ] Create orders table.
- [ ] Create order_items table.
- [ ] Create payments table.
- [ ] Create inventory_movements table.
- [ ] Add order service.
- [ ] Add payment service.
- [ ] Add pricing calculator.
- [ ] Use Decimal for all money.
- [ ] Add no-floats protection in money path.
- [ ] Add stock decrement with row-level locking.
- [ ] Add idempotency for order creation.
- [ ] Add audit logs.
- [ ] Add register UI.
- [ ] Add product grid.
- [ ] Add cart state.
- [ ] Add cash payment modal.
- [ ] Add manual transfer/card payment flow.
- [ ] Add success screen.
- [ ] Add basic receipt stub.
- [ ] Add money golden tests.
- [ ] Add order creation BDD.
- [ ] Add concurrent inventory decrement test.
- [ ] Add E2E cash sale.

## Sprint 3 — Split Payment + Receipt Stub Polish

### Goal

Complete core payment recording for beta.

### Required Specs

- `specs/orders/split_payment.md`
- `specs/orders/receipt_stub.md`

### Tasks

- [ ] Extend payment service.
- [ ] Extend order create payload.
- [ ] Add split payment validation.
- [ ] Add cash + transfer split.
- [ ] Add cash + manual card split.
- [ ] Add sum mismatch validation.
- [ ] Add payment breakdown UI.
- [ ] Add receipt payment breakdown.
- [ ] Add payment method totals.
- [ ] Add BDD split payment scenarios.
- [ ] Add E2E split payment.

## Sprint 4 — Offline Sync + Dead Letter

### Goal

The register works offline and safely syncs when back online.

### Required Specs

- `specs/orders/offline_sync.md`
- `specs/orders/dead_letter.md`

### Tasks

- [ ] Add Dexie schema.
- [ ] Add local sale queue.
- [ ] Add statuses: pending, syncing, synced, failed.
- [ ] Add sync worker.
- [ ] Add exponential backoff.
- [ ] Add dead-letter UI.
- [ ] Add conflict response handling.
- [ ] Add server sync endpoint.
- [ ] Add idempotency based on client_uuid.
- [ ] Add offline indicator.
- [ ] Add pending sync count.
- [ ] Add manual sync button.
- [ ] Add service worker/app shell caching.
- [ ] Add Playwright offline tests.
- [ ] Add duplicate sync tests.
- [ ] Add dead-letter recovery tests.

## Sprint 5 — Refunds, Voids, and Receipts

### Goal

Support real operational corrections after a sale.

### Required Specs

- `specs/orders/refund.md`
- `specs/orders/void.md`
- `specs/orders/receipt.md`

### Tasks

- [ ] Create refunds table.
- [ ] Create refund_items table.
- [ ] Add refund service.
- [ ] Add void service.
- [ ] Add receipt renderer.
- [ ] Add PDF generation if feasible.
- [ ] Add email receipt flow.
- [ ] Add receipt preview UI.
- [ ] Add refund modal.
- [ ] Add permission gates.
- [ ] Add audit logs.
- [ ] Add idempotency.
- [ ] Add refund golden tests.
- [ ] Add receipt snapshot/visual tests.

## Sprint 6 — Shifts + Cash Movements

### Goal

Reproduce and generalize the MVP’s shift reconciliation.

### Required Specs

- `specs/shifts/open.md`
- `specs/shifts/close.md`
- `specs/shifts/cash_movements.md`

### Tasks

- [ ] Create shifts table.
- [ ] Create cash_movements table.
- [ ] Add shift service.
- [ ] Add shift calculator.
- [ ] Add shift policy.
- [ ] Add open shift UI.
- [ ] Add active shift card.
- [ ] Add cash in/out UI.
- [ ] Add close shift wizard.
- [ ] Add shift history.
- [ ] Add expected cash golden tests.
- [ ] Add double-open concurrency test.
- [ ] Add offline close scenario if needed.

## Sprint 7 — Inventory Basics

### Goal

Allow owners to see and adjust stock beyond automatic sale decrement.

### Required Specs

- `specs/inventory/stock_take.md`
- `specs/inventory/adjustment.md`
- `specs/inventory/low_stock.md`

### Tasks

- [ ] Add inventory page.
- [ ] Add stock view.
- [ ] Add stock take endpoint.
- [ ] Add manual adjustment endpoint.
- [ ] Add low-stock threshold.
- [ ] Add low-stock dashboard widget.
- [ ] Add stock adjustment modal.
- [ ] Add stock take wizard.
- [ ] Add inventory audit logging.
- [ ] Add inventory BDD tests.

## Sprint 8 — Reporting v1

### Goal

Owner can understand basic sales performance.

### Required Specs

- `specs/reports/range.md`
- `specs/reports/payment_breakdown.md`
- `specs/reports/top_products.md`

### Tasks

- [ ] Add report service.
- [ ] Add date range aggregation.
- [ ] Add payment breakdown query.
- [ ] Add top products query.
- [ ] Add timezone handling.
- [ ] Add reporting indexes.
- [ ] Add reports UI.
- [ ] Add charts.
- [ ] Add CSV export if feasible.
- [ ] Add oracle aggregation tests.
- [ ] Add employee-scope permission tests.

## Sprint 9 — Billing: Standard Plan

### Goal

Make the product sellable through a single $199 MXN/month subscription plan.

### Required Specs

- `specs/billing/standard_plan.md`
- `specs/billing/checkout.md`
- `specs/billing/webhooks.md`
- `specs/billing/past_due.md`
- `specs/billing/cancellation.md`

### Tasks

- [ ] Create subscriptions table.
- [ ] Create webhook_events table.
- [ ] Add Stripe Checkout integration.
- [ ] Add Stripe Billing integration.
- [ ] Add webhook signature verification.
- [ ] Add webhook idempotency.
- [ ] Add subscription status model.
- [ ] Add billing settings page.
- [ ] Add past_due banner.
- [ ] Add grace period logic.
- [ ] Add cancellation flow.
- [ ] Add internal/admin subscription visibility.
- [ ] Ensure Standard Plan price is $199 MXN/month.
- [ ] Remove/defer plan-based feature gates.
- [ ] Add billing BDD tests.

## Sprint 10 — Bakery Preset + Tenant Settings + Onboarding

### Goal

A bakery/small food retail tenant can self-onboard and start selling faster.

### Required Specs

- `specs/onboarding/bakery_preset.md`
- `specs/settings/tenant_settings.md`
- `specs/onboarding/first_sale.md`

### Tasks

- [ ] Create tenant_settings table.
- [ ] Create location_settings table if needed.
- [ ] Add preset loader.
- [ ] Add `presets/bakery.json`.
- [ ] Add onboarding flow.
- [ ] Add settings page.
- [ ] Add business profile form.
- [ ] Add locale/currency/timezone wiring.
- [ ] Add first-sale checklist.
- [ ] Add preset BDD tests.
- [ ] Add settings audit tests.

## Sprint 14 — Beta Hardening

### Goal

Prepare the product for 3 friendly beta tenants.

### Required Specs

- `specs/security/rate_limit.md`
- `specs/security/headers.md`
- `specs/ops/backups.md`
- `specs/ops/monitoring.md`
- `specs/support/beta_support.md`

### Tasks

- [ ] Add rate limiting.
- [ ] Add CSP.
- [ ] Add HSTS.
- [ ] Verify secure cookies.
- [ ] Lock down CORS.
- [ ] Configure backups.
- [ ] Execute restore drill.
- [ ] Add status page or status process.
- [ ] Add uptime monitor.
- [ ] Configure Sentry alerts.
- [ ] Add support email/process.
- [ ] Add feedback widget.
- [ ] Add help center starter docs.
- [ ] Add beta agreement.
- [ ] Run dependency audit.
- [ ] Run basic load test.
- [ ] Complete beta checklist.

## Closed Beta

### Goal

Run the product with 3 friendly tenants.

### Commercial Beta Model

- 3 friendly tenants.
- Standard Plan at $199 MXN/month.
- Optional temporary beta discount, but official price remains visible.
- Founder-assisted onboarding is acceptable.
- Written feedback agreement.
- Weekly feedback session.
- Manual support channel.
- Clear beta disclaimer.
- No long-term contract.

### Success Criteria

- Tenant completes first sale without engineering intervention.
- Tenant uses the POS for at least 5 business days.
- No data-loss incidents.
- Offline sync works in at least one real or simulated outage.
- Owner checks reports at least once.
- Tenant is willing to continue paying after beta.
- Support can diagnose incidents using logs/Sentry.
- No P0 bugs remain open.

---

## Remaining Backlog

Sprints 16 through 22 are defined below in execution order.

Sprint 15 (Modifiers) is done and documented in `docs/current-sprint.md`.

Pre-beta ops tasks (Sentry DSN, backup drill, uptime monitor, support channel) must be completed
before the first beta tenant is onboarded. They are tracked in `docs/current-sprint.md` and are
not a numbered sprint — they are operational work that can run in parallel with Sprint 16.

---

## Sprint 16 — UX Polish + Onboarding + Mobile Hardening

### Goal

Make the product feel premium, mobile-ready, and immediately understandable for a new beta tenant.
A first-time user should be able to sign up, understand what to do next, and complete a first sale
without engineering assistance. The register must work correctly on a tablet browser.

### Product Outcome

- New tenants see a guided onboarding checklist on first login.
- The register works naturally on iPad/tablet and mobile browser.
- Category filter pills show readable names.
- Payment method selection uses a touch-friendly button group.
- Cashiers see a "Smart card pick" teaser when selecting card payment.
- The dashboard communicates daily performance clearly with differentiated visual cues.
- All hardcoded English strings are removed from JSX and live in `i18n/messages.ts`.

### Status

Partial. The following items shipped on 2026-05-14:

- [x] Mobile responsive sidebar with hamburger toggle and backdrop overlay
- [x] Mobile sticky top bar (logo + business name + hamburger)
- [x] Fix category pills — now load real category names in sort order
- [x] Replace payment `<select>` with touch-friendly 3-button picker (Cash / Transfer / Card)
- [x] Card recommendation stub (amber callout when Card is selected)
- [x] Dashboard KPI cards — distinct icon colors per metric (emerald / blue / violet / rose)
- [x] Dashboard — all hardcoded strings moved to `copy.dashboard.*`
- [x] Dashboard — locale uses `navigator.language` instead of hardcoded `"en"`
- [x] AppShell — fixed broken ChevronRight hover (was missing `group` class on NavLink)
- [x] Color token upgrade in `styles.css` (richer primary, deeper sidebar, cleaner background)

### Remaining Tasks

#### Onboarding

- [ ] Write Feature Spec: `specs/onboarding/first_sale.md`
- [ ] Write BDD scenarios: `specs/onboarding/first_sale.feature`
  - Given a new tenant signs up and has no products, When they reach the dashboard, Then a setup checklist is shown (Create catalog → Open shift → Make first sale).
  - Given a tenant has completed all checklist items, When they visit the dashboard, Then the checklist is hidden.
- [ ] Create `tenant_onboarding_state` table with completed step flags (tenant-scoped, RLS).
- [ ] Add `PATCH /api/v1/onboarding/steps/{step}` to mark steps complete.
- [ ] Add `GET /api/v1/onboarding/state` to fetch current checklist state.
- [ ] Add onboarding checklist component to `DashboardView`.
  - Steps: Add first product → Open first shift → Complete first sale.
  - Each step links to the relevant page.
  - Progress bar or step-completion badges.
  - Auto-dismiss when all steps are done.
- [ ] Write E2E test: new tenant flow — signup → dashboard shows checklist → first sale → checklist hidden.
- [ ] Add audit log event `onboarding.step.completed`.

#### Register — Stock Indicators

- [ ] Write Feature Spec: `specs/register/stock_indicators.md`
- [ ] Extend register load: call `listInventory()` in parallel with products and categories.
- [ ] Build `stockMap: Map<string, number>` (product_id → quantity_on_hand).
- [ ] Show "Low" badge on product card when `quantity_on_hand <= low_stock_threshold` and `track_inventory === true`.
- [ ] Show product card as visually muted (not disabled) when stock is 0 and `track_inventory === true`.
- [ ] Confirm: adding an out-of-stock item still enqueues the sale (backend validates on order creation).
- [ ] Add unit test for stock badge rendering logic.

#### Dashboard — Trend Comparison

- [ ] Write Feature Spec: `specs/dashboard/trend_comparison.md`
- [ ] Extend `getSalesSummary` to accept two date ranges (today + yesterday).
- [ ] Add `GET /api/v1/reports/summary?start=&end=` already exists — call it twice in parallel.
- [ ] Compute delta: `(today - yesterday) / yesterday * 100`.
- [ ] Add delta badge to each KPI card: green arrow up / red arrow down / grey flat.
- [ ] Handle zero-yesterday gracefully (show "—" instead of ∞%).
- [ ] Add unit test for delta computation logic.

#### Orders — Search and Filter

- [ ] Write Feature Spec: `specs/orders/order_list_filter.md`
- [ ] Add `start_date`, `end_date`, `status`, and `search` (order ID prefix) query params to `GET /api/v1/orders`.
- [ ] Add filter bar to `OrderListView`:
  - Date range picker (start / end).
  - Status dropdown (All / Completed / Voided).
  - Search input (order ID or amount).
- [ ] Add debounced search (300 ms).
- [ ] Add filter reset button.
- [ ] Add unit tests for filter query construction.
- [ ] Add E2E test: filter by date range returns expected results.

#### i18n Audit

- [ ] Audit all remaining views (`InventoryView`, `ShiftView`, `ReportsView`, `OrderDetail`, `BillingView`, `OrderListView`, `SyncQueueView`, `CatalogView`) for hardcoded English strings.
- [ ] Move any found strings into `copy.*` sections in `messages.ts`.
- [ ] Confirm `OrderListView` date uses `navigator.language` (currently hardcodes `"es-MX"`).
- [ ] Confirm all error/empty/loading strings are in the copy object.

#### Mobile Layout QA

- [ ] Test register on 375 px (iPhone SE), 768 px (iPad portrait), and 1024 px (iPad landscape).
- [ ] Ensure product grid is scrollable without horizontal overflow on mobile.
- [ ] Ensure cart and payment panel stack below product grid on single-column layout.
- [ ] Ensure touch targets ≥ 44 px on all interactive elements (product cards, quantity buttons, payment method buttons).
- [ ] Fix any z-index conflicts between the mobile top bar and Card components.
- [ ] Add Playwright viewport test for register flow at 375 px.

### Definition of Done

- Onboarding checklist renders for new tenants and clears on completion.
- Register works on iPad and mobile — no horizontal scroll, no overlapping elements.
- Category pills show readable names in all cases.
- Dashboard shows vs-yesterday delta on all KPIs.
- Orders list has functional date + status filter.
- Zero hardcoded English strings remain in JSX across all views.
- All new paths covered by unit or E2E tests.
- `npx tsc --noEmit` passes clean.

---

## Sprint 17 — Tax Engine

### Goal

Tenant owners can configure tax rates. The pricing calculator applies them correctly to every sale,
receipt, and report. Tax behavior is explicit, auditable, and passes money golden tests.

### Product Outcome

- Owner configures one or more tax rates (e.g. IVA 16%, reduced 8%).
- Tax can be tax-inclusive (price includes tax) or tax-exclusive (tax added on top).
- Each product or category can be assigned a tax rate.
- Receipts show line-item tax breakdown.
- Reports include a net vs. gross vs. tax breakdown.
- Tax round-half-up on each line, no float arithmetic anywhere.

### Required Specs

- `specs/tax/tax_rates.md`
- `specs/tax/tax_calculation.md`
- `specs/tax/receipt_tax.md`

### Data Model

- [ ] Create `tax_rates` table: `id`, `tenant_id`, `name`, `rate` (Decimal), `is_inclusive`, `is_active`.
- [ ] Create `product_tax_rates` join table: `product_id`, `tax_rate_id`.
- [ ] Create `category_tax_rates` join table: `category_id`, `tax_rate_id` (fallback if product has no rate).
- [ ] Add RLS policies on all tax tables.
- [ ] Write Alembic migration; document rollback.
- [ ] Extend `order_items` with `tax_rate_id`, `tax_amount` (Decimal string).
- [ ] Extend `payments` with `tax_total` (Decimal string) on the order level.

### Backend

- [ ] Add tax rate CRUD: `POST`, `GET`, `PATCH`, `DELETE /api/v1/tax-rates`.
- [ ] Add product tax assignment endpoint: `PUT /api/v1/catalog/products/{id}/tax-rate`.
- [ ] Add category tax assignment endpoint: `PUT /api/v1/catalog/categories/{id}/tax-rate`.
- [ ] Extend pricing calculator to resolve effective tax rate per line item (product rate → category rate → no tax).
- [ ] Implement tax-inclusive: `tax = price * rate / (1 + rate)`, `base = price - tax`.
- [ ] Implement tax-exclusive: `tax = base * rate`, `line_total = base + tax`.
- [ ] Round each line tax with `round_half_up` (Decimal, 2 places).
- [ ] Extend order creation payload to accept and persist tax breakdown.
- [ ] Extend reports aggregation to include `tax_total` column.
- [ ] Add `tax.configure` and `tax.assign` RBAC permissions (owner only).
- [ ] Add audit log for `tax.rate.create`, `tax.rate.update`, `tax.rate.deactivate`.
- [ ] Extend idempotency key coverage to order creation with tax.

### Frontend

- [ ] Add Tax Rates section to settings (new `SettingsView` or extend catalog area).
  - List tax rates with name, rate %, inclusive/exclusive badge.
  - Create / edit modal with name, rate, inclusive toggle.
  - Deactivate with confirmation.
- [ ] Add tax rate selector to product create/edit form in `CatalogView`.
- [ ] Add tax rate selector to category create/edit form.
- [ ] Show tax breakdown on receipt in `OrderDetail`:
  - Sub-total (before tax).
  - Tax name + amount.
  - Total (after tax).
- [ ] Show tax breakdown in `ReportsView` (tax collected column).
- [ ] Add i18n strings for all tax copy.

### Tests

- [ ] BDD: `specs/tax/tax_calculation.feature`
  - Tax-exclusive: $100 + 16% IVA = $116 total, $16 tax.
  - Tax-inclusive: $116 price at 16% → base $100, tax $16.
  - Zero tax rate: no tax line on receipt.
  - Mixed: two lines, one taxed, one not.
- [ ] Golden tests: `test_tax_money.py` — exact Decimal assertions for each scenario.
- [ ] Tenant isolation: tenant A cannot read tenant B's tax rates.
- [ ] Permission test: cashier cannot create or modify tax rates.
- [ ] E2E: complete sale with tax → receipt shows correct tax breakdown.

### Definition of Done

- Tax rates configurable per tenant.
- Pricing calculator applies correct rate per line with no float arithmetic.
- Receipts show sub-total, tax, total breakdown.
- Reports include tax column.
- All golden tests pass.
- Rollback migration documented.

---

## Sprint 18 — Discounts

### Goal

Cashiers can apply a discount to individual line items or the entire order. Every discount requires
a reason and is recorded in the audit log. Managers can restrict discount depth with a permission gate.

### Product Outcome

- Cashier selects a cart item and applies a flat or percentage discount.
- Cashier applies an order-level discount (applied after line totals).
- Manager can configure maximum discount percentage per role.
- Discount appears as a separate line on receipts and in reports.
- Discounts are audited with user, reason, and amount.

### Required Specs

- `specs/discounts/line_discount.md`
- `specs/discounts/order_discount.md`
- `specs/discounts/discount_limits.md`

### Data Model

- [ ] Add `discount_type` (`flat` | `pct`), `discount_value` (Decimal), `discount_reason` columns to `order_items`.
- [ ] Add `order_discount_type`, `order_discount_value`, `order_discount_reason` columns to `orders`.
- [ ] Write Alembic migration; document rollback.
- [ ] Extend pricing calculator to apply line discount before tax, order discount after line subtotals.

### Backend

- [ ] Add `DISCOUNT_APPLY` RBAC permission (cashier and above by default).
- [ ] Add `DISCOUNT_ABOVE_X_PCT` configurable permission or setting (deferred for v1 — hardcode to 50% max).
- [ ] Extend order creation endpoint to accept `discount_type` + `discount_value` + `discount_reason` per line and at order level.
- [ ] Add validation: discount cannot reduce line total below $0.
- [ ] Add validation: percentage discount max 100%.
- [ ] Extend pricing calculator: apply line discount first, then apply order discount to adjusted subtotal, then tax.
- [ ] Add audit log event `order.discount.applied` with amount, reason, user.
- [ ] Extend receipt serializer to show discount lines.
- [ ] Extend reports to include `discount_total` column in summary.

### Frontend

- [ ] Add discount control to each cart item in `RegisterView`:
  - Small "%" icon button opens a discount popover.
  - Input: type (flat / %) + amount + reason (required).
  - Show applied discount as a struck-through original price + discount badge.
- [ ] Add order-level discount section at the bottom of the cart (above total):
  - Same type / amount / reason inputs.
  - Show calculated discount line in the total breakdown.
- [ ] Update total breakdown to show: subtotal → line discounts → order discount → tax → total.
- [ ] Show discount lines on receipt in `OrderDetail`.
- [ ] Show discount total in `ReportsView` summary cards.
- [ ] Add i18n strings for all discount copy.

### Tests

- [ ] BDD: `specs/discounts/line_discount.feature`
  - Flat $10 off $50 item → line total $40.
  - 20% off $50 item → line total $40.
  - Line discount + tax: tax applies to post-discount price.
- [ ] BDD: `specs/discounts/order_discount.feature`
  - 10% order discount on $100 subtotal → $90 total.
  - Order discount + tax.
- [ ] Golden tests: `test_discount_money.py`.
- [ ] Permission test: unauthenticated user cannot apply discount.
- [ ] Audit log test: discount event recorded with correct fields.
- [ ] E2E: apply line discount → receipt shows discount line.

### Definition of Done

- Line and order discounts work with flat and percentage modes.
- Reason is required and audited.
- Discounts never produce negative line totals.
- Receipts and reports reflect discounts correctly.
- All golden tests pass.

---

## Sprint 19 — Card Recommendation v1

### Goal

Users can register their credit cards and benefit rules. At checkout, when a cashier selects card
payment, the app recommends the best card to use based on the current basket — showing expected
cashback, promotions, or months without interest. This turns the register into a smart financial
advisor for the customer.

### Product Outcome

- Tenant owner or manager can register cards (personal or shared business cards).
- Each card has named benefit rules: cashback %, points multiplier, MSI threshold, promo period.
- At checkout, when cart has items and "Card" is selected, a ranked recommendation list appears.
- Each card in the list shows the expected benefit in human-readable form ("~$32 cashback").
- The cashier (or customer) selects the recommended card.
- The selected card is recorded on the order for future benefit tracking.
- The recommendation stub (`copy.register.cardRecommendationHint`) is replaced with real data.

### Required Specs

- `specs/cards/card_management.md`
- `specs/cards/benefit_rules.md`
- `specs/cards/recommendation_engine.md`
- `specs/cards/checkout_recommendation.md`

### Data Model

- [ ] Create `cards` table:
  - `id`, `tenant_id` (RLS), `name` (e.g. "Citibanamex Rewards"), `issuer`, `last_4` (nullable), `card_network` (`visa` | `mastercard` | `amex` | `other`), `is_active`, `created_at`.
- [ ] Create `benefit_rules` table:
  - `id`, `card_id`, `tenant_id` (RLS), `rule_type` (`cashback_pct` | `points_multiplier` | `msi_threshold` | `flat_promo`), `value` (Decimal), `min_amount` (Decimal, nullable), `max_amount` (Decimal, nullable), `valid_from` (date, nullable), `valid_to` (date, nullable), `description` (text), `is_active`.
- [ ] Create `order_card_selection` table:
  - `id`, `order_id`, `card_id`, `tenant_id`, `selected_by_user_id`, `expected_benefit_value` (Decimal, nullable), `created_at`.
- [ ] Add RLS policies on all three tables.
- [ ] Write Alembic migration; document rollback.

### Backend

- [ ] Add Card CRUD endpoints with tenant scoping + RLS:
  - `POST /api/v1/cards` (create card)
  - `GET /api/v1/cards` (list tenant cards)
  - `PATCH /api/v1/cards/{id}` (update card name / last_4)
  - `DELETE /api/v1/cards/{id}` (soft deactivate)
- [ ] Add Benefit Rule CRUD endpoints:
  - `POST /api/v1/cards/{card_id}/benefit-rules`
  - `GET /api/v1/cards/{card_id}/benefit-rules`
  - `PATCH /api/v1/cards/{card_id}/benefit-rules/{rule_id}`
  - `DELETE /api/v1/cards/{card_id}/benefit-rules/{rule_id}`
- [ ] Add recommendation endpoint:
  - `POST /api/v1/recommend/card`
  - Request: `{ order_total: Decimal, items: [{ category_id, amount }] }`
  - Response: `{ recommendations: [{ card_id, card_name, rule_type, expected_benefit_value, description, rank }] }`
  - Engine logic:
    - Fetch active cards + active benefit rules for tenant.
    - Filter rules valid today (check `valid_from` / `valid_to`).
    - Filter rules that meet `min_amount` threshold.
    - Compute expected benefit per card: cashback → `total * rate`, MSI → eligible if `total >= threshold`, points → `total * multiplier`.
    - Rank cards by `expected_benefit_value` descending.
    - Return top 3 cards with computed benefit.
  - Use only Decimal arithmetic throughout; no floats.
- [ ] Add `POST /api/v1/orders/{id}/card-selection` to record which card was ultimately used.
- [ ] Add RBAC permissions: `cards.manage` (owner / manager only), `cards.view` (all roles).
- [ ] Add audit log events: `card.created`, `card.deactivated`, `benefit_rule.created`, `benefit_rule.deactivated`, `order.card_selected`.
- [ ] Add idempotency on `POST /api/v1/cards` and benefit rule creation.

### Frontend

**Card Management UI**
- [ ] Add `/cards` route under admin nav (icon: `CreditCard`).
- [ ] Add `CardsView` page:
  - List of registered cards with name, issuer, last 4 digits, active/inactive badge.
  - "Add card" button opens a modal: name, issuer, card network, last 4 (optional).
  - Edit card inline or via modal.
  - Deactivate card with confirmation dialog.
  - Empty state: "No cards registered yet. Add your first card to start getting smart recommendations."
- [ ] Add benefit rules panel below each card in `CardsView`:
  - List of rules per card (type, value, validity period, description).
  - "Add rule" button: rule type selector + value + amount bounds + date range + description.
  - Edit / deactivate individual rules.
  - Expired rules shown with muted styling.

**Checkout Recommendation**
- [ ] When `paymentMethod === "manual_card"` and `cartItems.length > 0`, call `POST /api/v1/recommend/card` with current cart state.
- [ ] Replace the static `cardRecommendationHint` stub with a live ranked recommendation list:
  - Show top 3 cards with card name, expected benefit, rule description.
  - Highlight the #1 pick with a "Best pick" badge and distinct border color.
  - Each card in the list is selectable — clicking it records the selection.
  - Loading skeleton while the API call resolves (< 200 ms target).
  - If no cards are registered, show the "Add your first card" empty state with a link to `/cards`.
  - If the API fails, fall back to a graceful "Could not load recommendations" message.
- [ ] Add `selectedCardId` state in `RegisterView`; pass it in the order submission payload.
- [ ] After sale completes, reset `selectedCardId`.
- [ ] Add i18n strings: `register.cardRecommendationLoading`, `register.cardBestPick`, `register.noCardsRegistered`, `register.addFirstCard`, `register.expectedBenefit`.

**Order Detail**
- [ ] If an order has a card selection, show it in `OrderDetail` under payments:
  - "Paid with [Card Name]" + expected benefit value.

### Tests

- [ ] BDD: `specs/cards/recommendation_engine.feature`
  - Given a basket of $500 MXN and a card with 2% cashback rule, When `/recommend/card` is called, Then the card is ranked first with expected benefit $10.
  - Given two cards (card A: 2% cashback, card B: 3 MSI at $300+), When basket is $350, Then both cards appear, card A ranked by cashback value, card B ranked by MSI convenience.
  - Given a card rule with `valid_to` yesterday, When recommendation runs today, Then the rule is excluded.
  - Given no active cards, When `/recommend/card` is called, Then response returns empty list.
- [ ] Golden tests: `test_recommendation_money.py` — all benefit computations use Decimal, no floats.
- [ ] Tenant isolation: tenant A cannot see tenant B's cards or benefit rules.
- [ ] Permission test: cashier can view recommendations but cannot manage cards.
- [ ] Audit log test: card creation and rule creation produce audit rows.
- [ ] E2E: register card → add benefit rule → go to checkout → recommendation appears → select card → order created with card selection.

### Definition of Done

- Cards and benefit rules are manageable per tenant.
- Recommendation endpoint returns ranked card list in < 200 ms for < 20 active rules.
- The checkout recommendation panel replaces the stub with live data.
- Card selection is persisted on the order.
- All money computations use Decimal — no floats.
- Tenant isolation tests pass.
- All BDD scenarios pass.

---

## Sprint 20 — Retail Preset + Advanced Inventory

### Goal

Retail tenants (general merchandise, small stores) can self-onboard using a preset that reflects
their workflow. Barcode/SKU input speeds up checkout. Stock history is auditable.

### Product Outcome

- A new "Retail" preset appears during onboarding with a sample catalog (electronics accessories, clothing sizes, snacks).
- Cashier can scan or type a SKU/barcode to add a product directly to the cart.
- Inventory view shows a full movement history per product.
- Low-stock report is available as a dedicated view.

### Required Specs

- `specs/onboarding/retail_preset.md`
- `specs/register/barcode_input.md`
- `specs/inventory/movement_history.md`
- `specs/inventory/low_stock_report.md`

### Tasks

#### Retail Preset

- [ ] Create `presets/retail.json` with sample categories: Electronics Accessories, Clothing, Food & Snacks.
- [ ] Create `presets/retail_products.json` with 10–15 sample products including SKUs.
- [ ] Add preset selection step to onboarding flow (Bakery / Retail / Blank).
- [ ] Add preset loader endpoint `POST /api/v1/onboarding/apply-preset`.
- [ ] Preset loader is idempotent (safe to call multiple times; skips if catalog already has products).
- [ ] Add BDD: preset applies correctly, all products are tenant-scoped, SKUs are set.
- [ ] Verify no hardcoded vertical assumptions remain in the pricing or register code.

#### Barcode / SKU Input

- [ ] Add a SKU/barcode search input to the top of the product grid in `RegisterView`.
- [ ] On input change (debounced 150 ms), filter products by exact SKU match first, then name prefix.
- [ ] If exactly one product matches the SKU, auto-add it to cart and clear the input.
- [ ] If multiple matches, show a dropdown with matches; user selects one.
- [ ] If no match, show "No product found for SKU: X" inline message.
- [ ] Support keyboard-only entry (barcode scanner emulates keyboard; Enter adds to cart).
- [ ] Add unit test for SKU match logic.
- [ ] Add E2E test: type SKU → product auto-added to cart.

#### Stock Movement History

- [ ] Add `movement_type` column to `inventory_movements` if not present: `sale` | `refund` | `void` | `manual_adjustment` | `stock_take`.
- [ ] Add `GET /api/v1/inventory/{product_id}/movements` paginated endpoint.
- [ ] Add movement history panel to `InventoryView` (expandable per product row).
- [ ] Show: date, movement type, delta, new quantity, performed by, reason.
- [ ] Add unit test for movement history query.

#### Low-Stock Report

- [ ] Add `GET /api/v1/inventory/low-stock` endpoint: returns products where `quantity_on_hand <= low_stock_threshold AND track_inventory = true`, ordered by urgency (quantity / threshold ratio asc).
- [ ] Add Low Stock tab or section to `InventoryView` and `ReportsView`.
- [ ] Show product name, current stock, threshold, suggested reorder quantity.
- [ ] Add "Export to CSV" button for the low-stock list.
- [ ] Add unit test for low-stock query.

### Definition of Done

- Retail preset applies without errors and creates a usable sample catalog.
- SKU input correctly finds and adds products.
- Movement history is visible per product.
- Low-stock report shows the correct filtered list.
- All new endpoints are tenant-scoped with permission checks and audit logs.

---

## Sprint 21 — Restaurant Preset

### Goal

Restaurant tenants can self-onboard with a preset and use the POS for a modifier-heavy table-service
workflow, including item notes per line and a kitchen view placeholder.

### Product Outcome

- "Restaurant" preset available during onboarding (Pizza, Burgers, Drinks categories with modifier groups).
- Cashiers can attach a free-text note to any cart item (e.g. "no onion", "extra sauce").
- Receipt and order detail show item notes.
- Foundation for KDS (Kitchen Display System) is in place — not a screen, just the data hook.

### Required Specs

- `specs/onboarding/restaurant_preset.md`
- `specs/register/item_notes.md`
- `specs/kds/kds_data_hook.md`

### Tasks

#### Restaurant Preset

- [ ] Create `presets/restaurant.json`: categories (Starters, Mains, Drinks, Desserts), sample products with modifier groups (size, extras).
- [ ] Add "Restaurant" option to preset selection step in onboarding.
- [ ] Preset loader creates modifier groups and assigns them to products.
- [ ] Add BDD: restaurant preset applies, modifier groups are accessible in register.
- [ ] Verify modifier modal works correctly with the preset-created groups.

#### Item Notes

- [ ] Add `note` (text, nullable) column to `order_items`. Alembic migration.
- [ ] Add note input to cart item in `RegisterView` (small "📝 Add note" link → inline text input).
- [ ] Note is included in order creation payload.
- [ ] Receipt / `OrderDetail` shows note beneath the product name (indented, muted).
- [ ] Note max length: 200 characters.
- [ ] Add unit test for note persistence on order creation.
- [ ] Add E2E test: add note → order created → note visible in order detail.

#### KDS Data Hook

- [ ] Add `kitchen_status` column to `orders`: `none` | `pending` | `in_progress` | `ready`. Default `none`.
- [ ] Add `PATCH /api/v1/orders/{id}/kitchen-status` endpoint (manager / owner only).
- [ ] Do not build a KDS screen in this sprint — data layer only.
- [ ] Document KDS screen as a deferred Sprint 23+ item in `docs/deferred-scope.md`.

### Definition of Done

- Restaurant preset creates a usable menu with modifier groups.
- Item notes are stored and displayed correctly.
- `kitchen_status` column exists and is patchable.
- No KDS UI introduced in this sprint.

---

## Sprint 22 — GA Hardening

### Goal

The product is ready for public launch. Legal documents are live, the marketing site is live,
the help center has enough articles for self-service, and the product passes a security review
and load test.

### Product Outcome

- Public signup available from the marketing site.
- Terms of Service, Privacy Policy, and DPA are linked at signup and in the app footer.
- Help center covers all north star flow steps with at least 30 articles.
- Product survives a 100 concurrent user load test without errors.
- WCAG AA accessibility pass on the register and dashboard.
- Status page is public and tied to uptime monitors.

### Required Specs

- `specs/legal/tos.md`
- `specs/legal/privacy_policy.md`
- `specs/marketing/marketing_site.md`
- `specs/ops/slos.md`
- `specs/ops/ga_checklist.md`

### Tasks

#### Legal

- [ ] Draft Terms of Service (MX jurisdiction, Spanish + English).
- [ ] Draft Privacy Policy (LFPDPPP compliant for MX; GDPR-ready for future).
- [ ] Draft DPA template for enterprise use (can be a stub at GA).
- [ ] Add ToS + Privacy Policy links to signup form (`AuthView`).
- [ ] Add ToS + Privacy Policy links to app footer.
- [ ] Add cookie banner if analytics or tracking cookies are used.
- [ ] Add "delete my account" flow or document data deletion process.

#### Marketing Site

- [ ] Build or deploy marketing site at root domain (separate repo or sub-path).
- [ ] Pages: Home, Features, Pricing ($199 MXN/month — Standard Plan), FAQ, Contact.
- [ ] Public Stripe Checkout link / embedded button on pricing page.
- [ ] SEO meta tags and OpenGraph images.
- [ ] Mobile-responsive.

#### Help Center

- [ ] Set up help center tool (Notion public page, HelpScout Docs, or Crisp).
- [ ] Write 30 articles covering:
  - Getting started (signup, business setup, first product, first sale).
  - Register (products, cart, payment methods, split payment, offline mode).
  - Catalog (categories, products, modifiers, images).
  - Inventory (stock tracking, adjustments, low-stock alerts).
  - Shifts (open, cash movements, close, reconciliation).
  - Reports (date ranges, payment breakdown, top products, export).
  - Billing (how to subscribe, past due, cancel, resume).
  - Cards (add card, benefit rules, checkout recommendation).
  - Security (passwords, sessions, logout all).
  - Troubleshooting (offline sync, receipt not showing, billing issues).
- [ ] Link help center from app (? icon or "Help" nav item).

#### Accessibility

- [ ] Run axe / Lighthouse accessibility audit on Register and Dashboard.
- [ ] Fix all WCAG AA failures (target: 0 critical, 0 serious violations).
- [ ] Verify color contrast ≥ 4.5:1 on all body text using updated color tokens.
- [ ] Verify all form inputs have visible labels (no placeholder-only labels).
- [ ] Verify keyboard navigation works across register, cart, and payment flows.
- [ ] Verify screen reader announces toast messages via `aria-live`.
- [ ] Verify modal focus management (focus traps, restore on close).

#### Security Review

- [ ] Run `npm audit` — zero high/critical in production deps.
- [ ] Run `uv pip audit` (or `safety check`) — zero high/critical.
- [ ] Review OWASP Top 10 checklist for each API layer.
- [ ] Verify CSP headers block inline scripts.
- [ ] Verify HSTS is enforced in production.
- [ ] Verify all cookies are `Secure; HttpOnly; SameSite=Lax`.
- [ ] Verify no tenant data leaks in error responses.
- [ ] Pen test: attempt cross-tenant data access via API — confirm 403/404.
- [ ] Review Sentry for any data leakage in error payloads.
- [ ] Rotate all secrets; verify no secrets in git history.

#### Load Testing

- [ ] Write k6 or Locust load test scripts covering:
  - 100 concurrent users: `POST /api/v1/orders` (cash sale).
  - 50 concurrent users: `GET /api/v1/catalog/products`.
  - 20 concurrent users: `GET /api/v1/reports/summary`.
- [ ] Target: p95 < 500 ms, p99 < 1 s, 0 errors at 100 concurrent.
- [ ] Fix any bottlenecks found (missing indexes, N+1 queries).
- [ ] Document load test results in `docs/risk-register.md`.

#### SLOs + Status Page

- [ ] Define SLOs: uptime 99.5%, p95 API latency < 500 ms, error rate < 0.1%.
- [ ] Wire UptimeRobot (or equivalent) to public status page.
- [ ] Status page shows: API, Frontend, Database, Billing (Stripe).
- [ ] Configure PagerDuty or email alerting for SLO breaches.

#### GA Checklist

- [ ] All beta tenant issues closed or documented.
- [ ] Zero open P0 bugs.
- [ ] Migration rollback plan documented for all migrations since beta.
- [ ] Data export process documented (tenant off-boarding).
- [ ] Run full BDD suite: all scenarios pass.
- [ ] Run full E2E suite: all scenarios pass.
- [ ] Production smoke test: complete a sale end-to-end on production.

### Definition of Done

- ToS and Privacy Policy live and linked.
- Marketing site live with public checkout.
- Help center has ≥ 30 articles.
- Accessibility: 0 WCAG AA critical/serious violations on register + dashboard.
- Load test: p95 < 500 ms at 100 concurrent users.
- Security review: 0 high/critical vulnerabilities.
- Status page live and tied to monitors.
- GA checklist 100% checked.

## Beta-Ready Checklist

### Product

- [ ] Tenant can sign up.
- [ ] Tenant can subscribe or start trial.
- [ ] Tenant can configure business settings.
- [ ] Tenant can create catalog.
- [ ] Cashier can open shift.
- [ ] Cashier can complete sale.
- [ ] Cash/manual payment flows work.
- [ ] Receipt is available.
- [ ] Offline sales are not lost.
- [ ] Failed offline sales are recoverable.
- [ ] Refunds/voids are available.
- [ ] Inventory decrement works.
- [ ] Shifts can be closed.
- [ ] Owner can see daily/range sales.
- [ ] No known P0 bugs open.

### Technical

- [ ] Alembic migrations only.
- [ ] Tenant isolation tests pass.
- [ ] RLS policies applied where needed.
- [ ] Auth/session tests pass.
- [ ] Write endpoint invariants pass.
- [ ] Money golden tests pass.
- [ ] Offline sync tests pass.
- [ ] No committed secrets.
- [ ] No critical/high vulnerabilities.
- [ ] Structured logs exist.
- [ ] Sentry exists.

### Billing

- [ ] Standard Plan exists in Stripe.
- [ ] Standard Plan price is $199 MXN/month.
- [ ] Checkout works.
- [ ] Webhooks are idempotent.
- [ ] Active subscription unlocks normal access.
- [ ] past_due behavior works.
- [ ] Grace period works.
- [ ] Cancellation works.

### Data

- [ ] Backups configured.
- [ ] Restore drill completed.
- [ ] Audit logs are append-only or protected.
- [ ] Tenant data export plan documented.

### Support

- [ ] Support email/channel ready.
- [ ] Basic runbooks exist.
- [ ] Feedback process exists.
- [ ] Beta agreement ready.

### UX

- [ ] Register usable on tablet.
- [ ] Loading states exist.
- [ ] Empty states exist.
- [ ] Error states exist.
- [ ] Offline states exist.
- [ ] Locale formatting verified for es-MX.

## GA-Ready Checklist

Adds to beta:

- [ ] Modifiers complete if restaurant support is included.
- [ ] Tax engine complete if needed for target market.
- [ ] Discounts complete.
- [ ] Retail preset complete.
- [ ] Restaurant preset complete only if modifiers are stable.
- [ ] Help center has 30+ articles.
- [ ] Marketing site live.
- [ ] Terms of Service complete.
- [ ] Privacy Policy complete.
- [ ] Cookie banner if needed.
- [ ] Security review complete.
- [ ] Load test complete.
- [ ] Accessibility pass complete.
- [ ] Status page tied to monitors.
- [ ] Public Stripe checkout from marketing site.
- [ ] Beta tenants migrated without data migration.

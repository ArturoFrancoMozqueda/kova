# Sprint Planning: Customizable Multi-Tenant POS Platform

## Status

Draft execution plan.

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

| Phase | Sprints | Outcome |
|---|---:|---|
| Foundation | 0A–0C | Repo, app skeleton, auth, tenant isolation, BDD harness |
| Core POS | 1–3 | Catalog, register, cash/manual sale, order creation |
| Offline + Recovery | 4 | Offline queue, sync, dead letter |
| Operations | 5–6 | Refunds, voids, receipts, shifts |
| Inventory + Reporting | 7–8 | Inventory basics, daily/range reports |
| Billing + Onboarding | 9–10 | $199 MXN plan, Stripe Billing, bakery preset |
| Beta Hardening | 11 | Security, monitoring, backup drill, beta support |
| Closed Beta | — | 3 friendly tenants |
| Post-Beta / GA Prep | 12+ | Modifiers, taxes, discounts, retail/restaurant presets, legal, marketing |

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

## Sprint 11 — Beta Hardening

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

## Post-Beta / GA Preparation

Only start after the beta core flow survives real usage.

### Sprint 12 — Modifiers

Tasks:

- [ ] Create modifier_groups table.
- [ ] Create modifier_options table.
- [ ] Create product_modifier_groups table.
- [ ] Create order_item_modifiers table.
- [ ] Add modifier CRUD.
- [ ] Add required/optional selection rules.
- [ ] Add min/max selection.
- [ ] Extend pricing calculator.
- [ ] Extend register UI.
- [ ] Extend receipts.
- [ ] Add BDD scenarios.
- [ ] Add money golden tests.

### Sprint 13 — Tax + Discounts

Tasks:

- [ ] Define tax-inclusive/exclusive rules.
- [ ] Create tax_rates table.
- [ ] Create category_tax_rates table.
- [ ] Add tax settings UI.
- [ ] Add per-line discount.
- [ ] Add per-order discount.
- [ ] Add discount reason.
- [ ] Add permission gates.
- [ ] Extend pricing calculator.
- [ ] Extend receipts.
- [ ] Add golden tests.

### Sprint 14 — Retail + Restaurant Presets

Tasks:

- [ ] Add retail preset.
- [ ] Add restaurant preset only if modifiers are stable.
- [ ] Add sample catalogs.
- [ ] Add barcode keyboard input if needed for retail.
- [ ] Verify no hardcoded vertical logic.
- [ ] Add preset BDD tests.

### Sprint 15 — GA Hardening

Tasks:

- [ ] Terms of Service.
- [ ] Privacy Policy.
- [ ] DPA if needed.
- [ ] Cookie banner if needed.
- [ ] Marketing site.
- [ ] Pricing page with Standard Plan.
- [ ] Help center with at least 30 articles.
- [ ] Support tooling.
- [ ] Security review.
- [ ] Load testing.
- [ ] Accessibility pass.
- [ ] SLOs.
- [ ] Status page tied to monitors.
- [ ] GA checklist.

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

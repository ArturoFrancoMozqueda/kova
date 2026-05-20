# Premium SaaS POS Experience

## Status

Draft for Sprint 16 UX polish and onboarding.

## Problem

New visitors and beta tenants need to understand the product quickly, see one simple subscription offer, and move from signup into a practical setup flow without confusion. The app must feel like a paid SaaS product while staying honest about supported capabilities.

## Target Users

- Bakery and small food retail owners evaluating the POS.
- Tenant owners and managers configuring the POS.
- Cashiers using the register after setup.

## Business Value

- Increase visitor confidence and signup conversion.
- Reduce first-sale setup friction.
- Make the $299 MXN/month Standard Plan feel concrete and valuable.
- Help owners understand performance from real operational data.

## Functional Requirements

- The public landing page must explain what the POS does, who it is for, why it matters, and what is included in the Standard Plan.
- The pricing section must show exactly one plan: Standard Plan, $299 MXN/month.
- The signup/login flow must preserve the clear path from account creation to subscription and setup.
- The in-app setup experience must focus on currently supported POS core setup: products/catalog, inventory, active subscription, and first sale.
- Logo and employee setup must not be presented as completed product flows until backend support exists.
- Analytics UI must only render metrics backed by production APIs.
- Empty states must be shown when real backend data is absent.
- Charts and KPI cards must communicate business decisions, not decorative activity.

## Non-Functional Requirements

- Responsive from mobile to desktop.
- No mock analytics data in production UI.
- No multi-tier pricing cards.
- No unsupported customization areas.
- No new backend writes without tenant scoping, permissions, idempotency where applicable, and audit logging.

## Data Model Impact

No schema changes in this UX-only pass.

Future data required:

- `tenant_settings.logo_url` or equivalent for logo upload/configuration.
- Employee invitation/member management API backed by memberships.
- Optional onboarding state table if explicit step dismissal is needed beyond derivation from real data.

## API Impact

No new API endpoints in this pass.

Existing real-data APIs used:

- `GET /api/v1/reports/sales-summary`
- `GET /api/v1/reports/payment-breakdown`
- `GET /api/v1/reports/top-products`
- `GET /api/v1/catalog/products`
- `GET /api/v1/catalog/categories`
- `GET /api/v1/inventory/stock`
- `GET /api/v1/inventory/low-stock`
- `GET /api/v1/billing/subscription`

## Permissions Impact

- Reports remain gated by `reports.view_all`.
- Billing remains gated by `billing.view` / `billing.manage`.
- Catalog and inventory actions keep existing permission checks.

## Offline Impact

No offline data model changes. The landing page and setup surfaces should not interfere with existing register offline queue behavior.

## Error States

- Analytics load failure shows retryable error state.
- No sales, no payments, no products, and no low-stock data show business-friendly empty states.
- Unsupported future setup areas are documented, not exposed as active production controls.

## Audit Log Behavior

No new mutations in this pass, so no new audit events.

## Acceptance Criteria

- Public root route presents a premium landing page instead of redirecting unauthenticated visitors to login.
- Authenticated owners and managers still have a clear path to the dashboard.
- Pricing is a single Standard Plan at $299 MXN/month.
- Dashboard and reports use real report APIs only.
- Dashboard setup recommendations are derived from real product, inventory, order, and billing state.
- The UI does not claim logo or employee management is complete until backend support exists.
- Mobile layouts stack cleanly without horizontal overflow.

## Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|
| SAAS-001 | `specs/onboarding/premium_saas_experience.feature` | Visitor understands the product | E2E | `frontend/e2e/app-shell.spec.ts` | Beta | Planned | Root route should be landing page. |
| SAAS-002 | `specs/onboarding/premium_saas_experience.feature` | Visitor sees one plan | E2E | `frontend/e2e/app-shell.spec.ts` | Beta | Planned | Exactly one $299 MXN/month pricing section. |
| SAAS-003 | `specs/onboarding/premium_saas_experience.feature` | User registers | E2E | `frontend/e2e/auth.spec.ts` | Beta | Existing | Signup and verification. |
| SAAS-004 | `specs/onboarding/premium_saas_experience.feature` | User pays | E2E | `frontend/e2e/billing.spec.ts` | Beta | Existing | Stripe Checkout redirect. |
| SAAS-005 | `specs/onboarding/premium_saas_experience.feature` | User enters onboarding | Component/E2E | TBD | Beta | Planned | Derived setup checklist. |
| SAAS-006 | `specs/onboarding/premium_saas_experience.feature` | User creates products | E2E | `frontend/e2e/catalog.spec.ts` | Beta | Existing | Catalog CRUD. |
| SAAS-007 | `specs/onboarding/premium_saas_experience.feature` | User manages inventory | E2E | `frontend/e2e/inventory.spec.ts` | Beta | Existing | Adjustments, stock take, thresholds. |
| SAAS-008 | `specs/onboarding/premium_saas_experience.feature` | User views real analytics | Backend BDD/E2E | `backend/app/tests/bdd/test_reports.py` | Beta | Existing | Sales summary, payments, top products. |
| SAAS-009 | `specs/onboarding/premium_saas_experience.feature` | Empty analytics state | E2E | `frontend/e2e/reports.spec.ts` | Beta | Existing/Planned | No fake KPIs beyond zeros from API. |
| SAAS-010 | `specs/onboarding/premium_saas_experience.feature` | Mobile experience | E2E | TBD | Beta | Planned | Landing/dashboard readable on mobile. |

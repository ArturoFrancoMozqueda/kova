# Test Matrix: First Sale Onboarding

Spec: `specs/onboarding/first_sale.md`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| ONB-001 | `specs/onboarding/first_sale.feature` | New tenant lands on a setup checklist after verifying email | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding` | Beta | Planned | Verify checklist visible and next action highlighted. |
| ONB-002 | `specs/onboarding/first_sale.feature` | Business profile step links to business profile settings | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @settings` | Beta | Planned | Link target navigates to business profile form. |
| ONB-003 | `specs/onboarding/first_sale.feature` | Receipt settings step links to receipt settings | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @settings` | Beta | Planned | Link target navigates to receipt settings form. |
| ONB-004 | `specs/onboarding/first_sale.feature` | Creating a product completes the catalog step | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @catalog` | Beta | Planned | Derive completion from real product list. |
| ONB-005 | `specs/onboarding/first_sale.feature` | Activating inventory completes the optional inventory step | E2E | `frontend/e2e/onboarding.spec.ts` | `@p1 @onboarding @inventory` | Beta | Planned | Step is optional but must reflect real state. |
| ONB-006 | `specs/onboarding/first_sale.feature` | Opening a shift completes the shift step | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @shifts` | Beta | Planned | Derive completion from shifts API. |
| ONB-007 | `specs/onboarding/first_sale.feature` | Completing the first sale marks first sale complete | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @orders` | Beta | Planned | Derive completion from orders API. |
| ONB-008 | `specs/onboarding/first_sale.feature` | Billing step reflects subscription or trial state | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @billing` | Beta | Planned | Source: `/api/v1/billing/subscription`. |
| ONB-009 | `specs/onboarding/first_sale.feature` | Cashier sees only the steps they can act on | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @permissions` | Beta | Planned | Permission-aware checklist. |
| ONB-010 | `specs/onboarding/first_sale.feature` | Checklist falls back gracefully when sources fail | E2E | `frontend/e2e/onboarding.spec.ts` | `@p1 @onboarding @errors` | Beta | Planned | Per-step retryable error state. |
| ONB-011 | `specs/onboarding/first_sale.feature` | Setup and signup copy is localized | E2E | `frontend/e2e/onboarding.spec.ts` | `@p0 @onboarding @i18n` | Beta | Planned | All visible strings via i18n keys. |
| ONB-012 | `specs/onboarding/first_sale.feature` | Derived onboarding state endpoint returns tenant-scoped snapshot | Backend integration | `backend/app/tests/test_onboarding_api.py` | `@p0 @onboarding @tenant-isolation` | Beta | Planned | Verify endpoint filters by tenant. |
| ONB-013 | `specs/onboarding/first_sale.feature` | Onboarding state is tenant-isolated | Backend integration | `backend/app/tests/test_onboarding_api.py` | `@p0 @onboarding @tenant-isolation` | Beta | Required | Tenant A cannot see Tenant B onboarding state. |

## Coverage Checklist

- Happy path from signup to first sale.
- Per-step derivation from real backend data.
- Permission-aware rendering (owner, manager, cashier).
- Tenant isolation on the onboarding endpoint.
- Graceful per-source error handling.
- i18n coverage on signup, login, and onboarding surfaces.
- Mobile viewport (390px) layout.

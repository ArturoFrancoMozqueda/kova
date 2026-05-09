# Billing Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| BIL-001 | specs/billing/billing.feature | Tenant owner starts checkout for the Standard Plan | Backend BDD | backend/app/tests/bdd/test_billing.py | @billing @money | Beta | Required | Mock Stripe API |
| BIL-002 | specs/billing/billing.feature | Tenant returns from successful checkout | E2E | frontend/e2e/billing.spec.ts | @billing @ui | Beta | Required | Mock API response |
| BIL-003 | specs/billing/billing.feature | Stripe webhook activates a subscription idempotently | Backend BDD | backend/app/tests/bdd/test_billing_webhooks.py | @billing @webhook @idempotency | Beta | Required | Verify signature |
| BIL-004 | specs/billing/billing.feature | Duplicate Stripe webhook does not duplicate side effects | Backend BDD | backend/app/tests/bdd/test_billing_webhooks.py | @billing @webhook @idempotency @audit-log | Beta | Required | Unique Stripe event id |
| BIL-005 | specs/billing/billing.feature | Past due tenant sees recovery guidance | E2E | frontend/e2e/billing.spec.ts | @billing @ui | Beta | Required | i18n banner copy |
| BIL-006 | specs/billing/billing.feature | Tenant owner cancels subscription | Backend BDD | backend/app/tests/bdd/test_billing.py | @billing @audit-log | Beta | Required | Mock Stripe API |
| BIL-007 | specs/billing/billing.feature | Non-owner cannot manage billing | Backend BDD | backend/app/tests/bdd/test_billing.py | @permission | Beta | Required | |
| BIL-008 | specs/billing/billing.feature | Tenant isolation for billing | Backend BDD | backend/app/tests/bdd/test_billing.py | @tenant-isolation | Beta | Required | |

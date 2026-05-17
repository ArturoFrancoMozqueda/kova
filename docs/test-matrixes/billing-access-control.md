# Billing Access Control Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| BAC-001 | `specs/billing/access_control.feature` | Tenant in signup trial can create a sale | Backend integration | `backend/app/tests/test_billing_access_control.py` | `@p0 @billing @orders` | Beta | Required | Trial derived from tenant creation |
| BAC-002 | `specs/billing/access_control.feature` | Tenant after trial expiry is blocked from creating a sale | Backend integration | `backend/app/tests/test_billing_access_control.py` | `@p0 @billing @orders @audit` | Beta | Required | Expects `402` and audit log |
| BAC-003 | `specs/billing/access_control.feature` | Tenant with an active subscription can create a sale | Backend integration | `backend/app/tests/test_billing_access_control.py` | `@p0 @billing @orders` | Beta | Required | Subscription tenant-scoped |
| BAC-004 | `specs/billing/access_control.feature` | Blocked tenant can still start billing recovery | Backend integration | `backend/app/tests/test_billing_access_control.py` | `@p0 @billing` | Beta | Required | Checkout remains recoverable |

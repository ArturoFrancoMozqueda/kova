# Test Matrix: Register + Online Sale

Spec:
- `specs/orders/cash_sale.md`
- `specs/orders/manual_payment.md`
- `specs/orders/split_payment.md`
- `specs/inventory/decrement.md`
- `specs/pricing/money_rules.md`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| ORDER-001 | specs/orders/online_sale.feature | Cashier completes a cash sale | Backend BDD | backend/app/tests/bdd/test_online_sale.py | @p0 @orders @money @idempotency @audit | Beta | Required | First north-star sale path |
| ORDER-002 | specs/orders/online_sale.feature | Cashier records a bank transfer sale | Backend BDD | backend/app/tests/bdd/test_online_sale.py | @p0 @orders @payment | Beta | Required | Manual payment record |
| ORDER-003 | specs/orders/online_sale.feature | Tenants cannot read each other's orders | Backend BDD | backend/app/tests/bdd/test_online_sale.py | @p0 @orders @tenant-isolation | Beta | Required | Cross-tenant read isolation |
| ORDER-004 | specs/pricing/money_rules.md | Money golden cases | Unit | backend/app/tests/test_pricing.py | @money | Beta | Required | Decimal-only totals |
| ORDER-005 | specs/inventory/decrement.md | Tracked product creates sale movement | Integration | backend/app/tests/test_orders.py | @inventory | Beta | Required | Movement is atomic with order |
| ORDER-006 | specs/orders/cash_sale.md | Idempotent order replay | Integration | backend/app/tests/test_orders.py | @idempotency | Beta | Required | Duplicate submit protection |
| ORDER-007 | specs/orders/split_payment.feature | Cashier completes a split cash and bank transfer payment | Backend BDD | backend/app/tests/bdd/test_split_payment.py | @p0 @orders @money | Beta | Automated | Backend support exists for 1-N payments |
| ORDER-008 | specs/orders/split_payment.md | Cash + transfer/card split validation | Integration | backend/app/tests/test_split_payment.py | @orders @money | Beta | Automated | Includes mismatch and tendered-low validation |
| ORDER-009 | specs/orders/split_payment.md | Register creates split payment payload | Frontend unit | frontend/src/__tests__/App.test.tsx | @ui @orders @money | Beta | Automated | Validates cash + bank transfer payload |
| ORDER-010 | specs/orders/split_payment.md | Register split payment checkout | E2E | frontend/e2e/register-sale.spec.ts | @ui @orders @money | Beta | Automated | Validates full split interaction and payload |

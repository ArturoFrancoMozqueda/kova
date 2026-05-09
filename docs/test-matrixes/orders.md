# Test Matrix: Register + Online Sale

Spec:
- `specs/orders/cash_sale.md`
- `specs/orders/manual_payment.md`
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

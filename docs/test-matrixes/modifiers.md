# Test Matrix: Modifiers

Spec:
- `specs/catalog/modifiers.md`
- `specs/catalog/modifiers.feature`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| MOD-001 | specs/catalog/modifiers.feature | Owner creates modifier group, assigns to product, cashier orders with modifier | Backend BDD | backend/app/tests/bdd/test_modifiers.py | @p0 @catalog @modifiers @money | GA prep | Required | Covers modifier snapshot + price uplift |
| MOD-002 | specs/catalog/modifiers.feature | Multiple modifier groups sum correctly | Backend BDD | backend/app/tests/bdd/test_modifiers.py | @p0 @catalog @modifiers @money | GA prep | Required | Price aggregation |
| MOD-003 | specs/catalog/modifiers.feature | Required modifier not selected is rejected | Backend BDD | backend/app/tests/bdd/test_modifiers.py | @p0 @catalog @modifiers | GA prep | Required | Validation boundary |
| MOD-004 | specs/catalog/modifiers.feature | Cashier cannot create modifier groups | Backend BDD | backend/app/tests/bdd/test_modifiers.py | @p0 @catalog @modifiers @permission | GA prep | Required | Permission boundary |
| MOD-005 | specs/catalog/modifiers.feature | Modifier groups are tenant-scoped | Backend BDD | backend/app/tests/bdd/test_modifiers.py | @p0 @catalog @modifiers @tenant-isolation | GA prep | Required | Cross-tenant read isolation |
| MOD-006 | specs/catalog/modifiers.md | Register opens selection modal and sends modifier option IDs | Frontend E2E | frontend/e2e/modifiers.spec.ts | @ui @modifiers | GA prep | Passing locally | 4 scenarios passed on 2026-05-13 |
| MOD-007 | specs/catalog/modifiers.md | Receipt renders selected modifier snapshots | Unit / component | frontend/src/orders/OrderDetail.test.tsx | @receipt @modifiers | GA prep | Added | Covers rendered receipt modifier line |

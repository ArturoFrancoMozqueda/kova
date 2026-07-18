# Inventory Basics Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| INV-001 | specs/inventory/inventory_basics.feature | Manager manually adjusts stock | Backend BDD | backend/app/tests/bdd/test_inventory_basics.py | @inventory @audit | Beta | Automated | |
| INV-002 | specs/inventory/inventory_basics.feature | Manager performs a stock take | Backend BDD | backend/app/tests/bdd/test_inventory_basics.py | @inventory | Beta | Automated | |
| INV-003 | specs/inventory/inventory_basics.feature | Low stock threshold flags product | Backend BDD | backend/app/tests/bdd/test_inventory_basics.py | @inventory | Beta | Automated | |
| INV-004 | specs/inventory/inventory_basics.feature | Permission denied without inventory adjust permission | Backend BDD | backend/app/tests/bdd/test_inventory_basics.py | @permission | Beta | Automated | |
| INV-005 | specs/inventory/inventory_basics.feature | Tenant isolation: cannot see another tenant's stock | Backend BDD | backend/app/tests/bdd/test_inventory_basics.py | @tenant-isolation | Beta | Automated | |
| INV-006 | frontend/e2e/inventory.spec.ts | inventory page supports adjustment, stock take, and low-stock UI | E2E | frontend/e2e/inventory.spec.ts | @ui | Beta | Automated | Mocked API |
| INV-007 | specs/inventory/inventory_basics.feature | Typed waste remains visible in kardex and valued reporting | E2E | frontend/e2e/reports.spec.ts | @ui @inventory @reports @money | Beta | Automated | Cross-view flow verifies adjustment payload, kardex reason, and valued waste panel |

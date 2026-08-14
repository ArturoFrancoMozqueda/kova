# Test Matrix: Catalog Foundation

Spec:
- `specs/catalog/categories.md`
- `specs/catalog/products.md`
- `specs/catalog/variants.md`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| CATALOG-001 | specs/catalog/catalog_foundation.feature | Tenant owner creates and lists a category and product | Backend BDD | backend/app/tests/bdd/test_catalog_foundation.py | @p0 @catalog @tenant-isolation @audit @idempotency | Beta | Required | Covers happy path and write invariants |
| CATALOG-002 | specs/catalog/catalog_foundation.feature | Cashier cannot create catalog products | Backend BDD | backend/app/tests/bdd/test_catalog_foundation.py | @p0 @catalog @permission | Beta | Required | Permission boundary |
| CATALOG-003 | specs/catalog/catalog_foundation.feature | Tenants cannot see each other's catalog products | Backend BDD | backend/app/tests/bdd/test_catalog_foundation.py | @p0 @catalog @tenant-isolation | Beta | Required | Cross-tenant read isolation |
| CATALOG-004 | specs/catalog/products.md | Product price remains Decimal | Unit | backend/app/tests/test_catalog.py | @money | Beta | Required | No float math |
| CATALOG-005 | specs/catalog/categories.md | Idempotency key replay returns stored response | Integration | backend/app/tests/test_catalog.py | @idempotency | Beta | Required | Create replay |
| CATALOG-006 | frontend/e2e/catalog.spec.ts | Owner reviews and confirms a valid CSV import | E2E | frontend/e2e/catalog.spec.ts | @ui @catalog @import | Beta | Automated | Commit occurs only after a clean dry-run preview |
| CATALOG-007 | frontend/e2e/catalog.spec.ts | CSV rows with errors block import confirmation | E2E | frontend/e2e/catalog.spec.ts | @ui @catalog @import | Beta | Automated | Shows row-level feedback and sends no commit request |
| CATALOG-008 | docs/adr/ADR-013-catalog-csv-import.md | UTF-8 BOM and es-MX accents survive catalog preview | Backend integration | backend/app/tests/test_catalog_import.py | @catalog @import @encoding | Beta | Automated | Proves Excel-friendly BOM handling without normalizing away accents or ñ |
| CATALOG-009 | docs/adr/ADR-013-catalog-csv-import.md | Import failure rolls back every catalog write | Backend integration | backend/app/tests/test_catalog_import.py | @catalog @import @transaction | Beta | Automated | Simulates a failure after the first product and verifies no product, movement, or audit row remains |
| CATALOG-010 | docs/adr/ADR-013-catalog-csv-import.md | Replayed commit returns the stored response once | Backend integration | backend/app/tests/test_catalog_import.py | @catalog @import @idempotency | Beta | Automated | Same tenant, key and file produce one import and one audit event |

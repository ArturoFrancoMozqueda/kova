# Reports Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| RPT-001 | specs/reports/reports.feature | Manager views a sales range summary | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | |
| RPT-002 | specs/reports/reports.feature | Manager views payment method totals | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | |
| RPT-003 | specs/reports/reports.feature | Manager views top products | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports | Beta | Automated | |
| RPT-004 | specs/reports/reports.feature | Permission denied without reports view permission | Backend BDD | backend/app/tests/bdd/test_reports.py | @permission | Beta | Automated | |
| RPT-005 | specs/reports/reports.feature | Tenant isolation: cannot see another tenant's reports | Backend BDD | backend/app/tests/bdd/test_reports.py | @tenant-isolation | Beta | Automated | |
| RPT-006 | frontend/e2e/reports.spec.ts | reports page displays summary, payments, and top products | E2E | frontend/e2e/reports.spec.ts | @ui | Beta | Automated | Mocked API |
| RPT-007 | specs/reports/reports.feature | Manager views hourly sales trend | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | Endpoint: `GET /api/v1/reports/sales-by-hour?start=&end=` |
| RPT-008 | specs/reports/reports.feature | Manager views employee sales performance | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @permission | Beta | Automated | Endpoint: `GET /api/v1/reports/sales-by-employee?start=&end=` |
| RPT-009 | specs/reports/reports.feature | Manager views refund reasons | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | Endpoint: `GET /api/v1/reports/refunds-by-reason?start=&end=` |
| RPT-010 | specs/reports/reports.feature | Manager views the business story report | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | Endpoint: `GET /api/v1/reports/business-story?start=&end=` |
| RPT-011 | specs/reports/reports.feature | Manager views an empty business story report | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports | Beta | Automated | No demo data or invented insights |
| RPT-012 | frontend/e2e/reports.spec.ts | reports page displays business storytelling layout | E2E | frontend/e2e/reports.spec.ts | @ui @reports | Beta | Automated | Mocked business-story API |
| RPT-013 | specs/reports/reports.feature | Owner sees a compact decision brief | E2E | frontend/e2e/reports.spec.ts | @ui @reports @insights | Beta | Automated | Verifies previous-period comparison, low-stock restock guidance, and max 3 actions |

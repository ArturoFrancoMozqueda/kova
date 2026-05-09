# Reports Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| RPT-001 | specs/reports/reports.feature | Manager views a sales range summary | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | |
| RPT-002 | specs/reports/reports.feature | Manager views payment method totals | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports @money | Beta | Automated | |
| RPT-003 | specs/reports/reports.feature | Manager views top products | Backend BDD | backend/app/tests/bdd/test_reports.py | @reports | Beta | Automated | |
| RPT-004 | specs/reports/reports.feature | Permission denied without reports view permission | Backend BDD | backend/app/tests/bdd/test_reports.py | @permission | Beta | Automated | |
| RPT-005 | specs/reports/reports.feature | Tenant isolation: cannot see another tenant's reports | Backend BDD | backend/app/tests/bdd/test_reports.py | @tenant-isolation | Beta | Automated | |
| RPT-006 | frontend/e2e/reports.spec.ts | reports page displays summary, payments, and top products | E2E | frontend/e2e/reports.spec.ts | @ui | Beta | Automated | Mocked API |

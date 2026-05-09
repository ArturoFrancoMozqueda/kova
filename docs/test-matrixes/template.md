# Test Matrix: <Feature Name>

Spec: `<link-to-spec>`

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Tags | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|---|
| FEATURE-001 | specs/<domain>/<feature>.feature | Happy path | Backend BDD | backend/app/tests/bdd/test_<feature>.py | @p0 | Beta | Required | |

## Coverage Checklist

- Happy path
- Permission denied
- Tenant isolation
- Idempotency, if applicable
- Offline/sync behavior, if applicable
- Money and rounding behavior, if applicable
- Error states and recovery
- Audit log behavior

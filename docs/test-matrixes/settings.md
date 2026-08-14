# Settings Test Matrix

## Receipt Settings

| Case | Layer | Coverage |
|---|---|---|
| Fresh tenant opens receipt settings without a saved row | Backend integration | `test_business_settings_isolation` verifies `GET /api/v1/settings/receipt` returns `200` with tenant-name defaults. |
| Tenant receipt settings stay isolated | Backend integration | `test_business_settings_isolation` saves different receipt settings for two tenants and confirms each tenant reads only its own values. |
| Production receipt is readable without unsafe settings mutation | Production smoke E2E | `production-smoke.spec.ts` validates the receipt produced by the deterministic smoke sale only when mutations are explicitly authorized; read-only runs never overwrite receipt settings. Console, page, network, 5xx and missing request-correlation errors fail the suite. |

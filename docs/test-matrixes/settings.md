# Settings Test Matrix

## Receipt Settings

| Case | Layer | Coverage |
|---|---|---|
| Fresh tenant opens receipt settings without a saved row | Backend integration | `test_business_settings_isolation` verifies `GET /api/v1/settings/receipt` returns `200` with tenant-name defaults. |
| Tenant receipt settings stay isolated | Backend integration | `test_business_settings_isolation` saves different receipt settings for two tenants and confirms each tenant reads only its own values. |
| Production receipt settings route does not 404 or log console errors | Production smoke E2E | `production-smoke.spec.ts` logs in, opens `/settings/receipt`, checks no missing-settings text, saves the form, and fails on console/page errors. |


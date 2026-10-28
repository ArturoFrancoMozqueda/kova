# Production Smoke Spec

## Problem

The product needs a repeatable smoke test after every production deployment. The review found
issues that were only visible in a real production browser: stale service worker behavior, CSP font
blocking, pricing mismatch, and Stripe sandbox checkout.

## Target Users

- Internal support operator
- Engineer performing release validation

## Business Value

A short smoke script protects the paid beta path and gives confidence that the product is sellable
after deploy.

## Scope

Coverage reviewed against the checked-in runner on 2026-10-26. The default browser smoke reads
business data and exercises login, cookie refresh and logout; those session operations still write
authentication state. It does not create accounts, subscriptions, sales, payments or orders.
An existing, separate opt-in case can record an explicitly authorized POS sale.

The public frontend/API are Cloudflare-hosted; Vercel remains the protected release candidate and
fallback. See the [architecture](../../docs/claude/architecture-context.md) and
[frontend deployment](../../deploy/cloudflare/README.md). A Vercel candidate marked READY alone
does not prove that the current public Cloudflare build has been accepted.

## Automated Browser Coverage

Source: [production-smoke.spec.ts](../../frontend/e2e/production-smoke.spec.ts).

- Landing loads and contains the existing 299 pricing expectation, not the retired 199 copy.
- Login establishes the explicitly supplied expected tenant; dashboard loads.
- Cookie session refresh includes the existing CSRF header and succeeds.
- Billing renders its existing price expectation. This is a UI check, not a Stripe Price lookup.
- Catalog, inventory, shifts, orders and reports load their headings without a financial mutation.
- Logout redirects to login and an authenticated route remains inaccessible afterward.
- Console/page errors, unexpected failed requests, API 5xx and missing correlated `x-request-id`
  responses fail the smoke, with the runner's declared telemetry exception.

The runner does **not** open Stripe Checkout, verify its live mode, complete a subscription or
observe a webhook. It does not assert that a new sale appears in report totals, test signup/email
delivery, or establish returning-PWA update behavior. Those need their own acceptance evidence.

## Smoke Command

Run from `frontend/` only for an intentionally selected release target. Load
`PRODUCTION_SMOKE_EMAIL`, `PRODUCTION_SMOKE_PASSWORD` and `PRODUCTION_SMOKE_TENANT_ID` from the
operator's approved configuration. The [production config](../../frontend/playwright.production.config.ts)
currently also requires `VERCEL_AUTOMATION_BYPASS_SECRET` and sets candidate-bypass headers; load it
from the secret store, never inline it in a shared command, report or screenshot. Use only the
verified Kova public origin below or the exact captured protected candidate.

```bash
PRODUCTION_SMOKE=1 \
PLAYWRIGHT_BASE_URL=https://kovasuite.com \
PRODUCTION_SMOKE_ALLOW_MUTATIONS=0 \
npm run test:production-smoke
```

No checkout-mode environment flag exists in this runner. Setting one cannot establish live Stripe
acceptance. Credentials and bypass material must never be committed or included in evidence.

## Existing Authorized Sale Case

Only after explicit authorization for the specified tenant/product/amount and an existing active
shift, set `PRODUCTION_SMOKE_ALLOW_MUTATIONS=1` and supply `PRODUCTION_SMOKE_PRODUCT_NAME`,
`PRODUCTION_SMOKE_CLIENT_UUID` and `PRODUCTION_SMOKE_REFERENCE`. Without that opt-in, the case
annotates its read-only policy and only loads reports.

The enabled case selects that exact product and records a **manual bank-transfer** sale with the
supplied reference and stable client UUID. It verifies the sync request, opens the resulting order
receipt, then loads reports. It does not move money through a bank/PSP, prove a transfer occurred,
open a shift, choose the first arbitrary product or complete a cash sale. Stable UUID checking is
not itself a replay test. The operator must reconcile the authorized record and report totals.

## Release and Manual Acceptance

- Require the exact release commit's aggregate `CI required` gate. The existing
  [release verifier](../../frontend/scripts/verify-deployment.mjs) checks the public site, frontend
  build hash, full backend SHA, database health and same-origin API proxy. Record the accepted
  Cloudflare versions/captured Vercel candidate and expected Alembic revision; do not infer these
  from a green browser heading.
- Verify returning-PWA installation/update and the intended physical devices separately, including
  menu/member-code/QR use when offered. Responsive browser tests do not certify physical scanners.
- Before paid public selling, record supervised **Stripe live** acceptance: actual configured
  price/mode, checkout, verified webhook, subscription/access convergence and failure/cancellation
  behavior. Use the existing [billing scenarios](../billing/billing.feature); this smoke and the
  [test-mode drill](../../docs/runbooks/stripe-sandbox-drill.md) do not close that gate.
- Complete the [paid-beta operational gate](../../docs/runbooks/ops-beta-gate.md) for real lifecycle
  email inbox delivery and accepted support/legal/retention terms. A branded mailbox is deferred
  for founder-assisted beta; do not claim it is required instead of the accepted support channel.
- Preserve the [real logical restore evidence](https://github.com/ArturoFrancoMozqueda/kova/blob/34b7df6e6cf768b0b18276e0ea39d5ee0637ddab/docs/audits/KOVA-R2-REAL-RESTORE-2026-10-10.md).
  It proves its recorded R2 snapshots/RLS/cleanup; fresh-host recovery, provider-managed schemas,
  later migrations, traffic switching and full service RTO remain separate checks in the
  [restore runbook](../../docs/runbooks/restore-supabase-backup.md).

## Non-Functional Requirements

- Any authorized smoke sale uses a known reviewed amount and an identifiable support reference.
- Evidence records target, commit/deployment, date, operator role, scope and result; record created
  order/operation references only in restricted operational evidence.
- Omitted financial, provider or physical-device checks remain explicitly unverified. Do not put
  credentials, connection URLs, cookies, customer contacts or payment details in reports.

## Acceptance Criteria

- The default result certifies only its documented read/session coverage on the selected target.
- A release is not production-validated until release metadata and applicable manual checks pass
  or a scoped exception is accepted and recorded.
- A public-selling release remains blocked by missing live billing and the applicable operational
  gates; successful local tests or a read-only browser smoke cannot substitute for that evidence.
- Any failed check creates a backlog item with severity and owner.

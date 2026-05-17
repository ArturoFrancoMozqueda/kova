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

Smoke checks cover the production frontend, backend proxy, authentication, billing, register, receipt,
reports, browser console, and deployment metadata.

## Required Checks

- Production URL loads the current landing page.
- Returning browser does not remain stuck on stale app shell after update prompt is accepted.
- Browser console has zero errors on:
  - `/`
  - `/login`
  - `/dashboard`
  - `/settings/billing`
  - `/register`
- Landing page shows one Standard Plan at 199 MXN/month.
- Dashboard onboarding copy shows 199 MXN/month.
- Billing API and UI show 199 MXN/month.
- Stripe Checkout opens in the expected mode for the current release phase:
  - `test` while the app is still pre-launch.
  - `live` before paid beta or public selling.
- Login works with the support smoke account.
- Register can complete a small cash sale.
- Order detail receipt opens for the created sale.
- Reports include the created sale for the selected date.
- Vercel latest production deployment is `READY`.
- Supabase project is healthy and Alembic version matches expected release notes.

## Smoke Command

Run the browser smoke against production only when intentionally validating a release:

```bash
PRODUCTION_SMOKE=1 \
PLAYWRIGHT_BASE_URL=https://point-of-sale-ochre.vercel.app \
PRODUCTION_SMOKE_EMAIL=posprojectsupport@gmail.com \
PRODUCTION_SMOKE_PASSWORD=<support-password> \
PRODUCTION_SMOKE_STRIPE_MODE=test \
npm run test:production-smoke
```

The support password must come from the operator's secret store or local shell. It must never be
committed to the repository.

## Automated Browser Coverage

- Landing page loads and does not show stale 299 MXN pricing.
- Login works with the support smoke account.
- Dashboard loads after login.
- Billing page shows the Standard Plan price as 199 MXN/month.
- Checkout redirects to `checkout.stripe.com`.
- When `PRODUCTION_SMOKE_STRIPE_MODE=test`, Checkout must expose a `cs_test` session id.
- When `PRODUCTION_SMOKE_STRIPE_MODE=live`, Checkout must not expose a `cs_test` session id.
- Register creates a small identifiable cash sale using the first available catalog product.
- The created order receipt opens.
- Reports page loads backend sales data after the smoke sale.
- Browser console and page errors are collected for app pages and fail the smoke.

## Manual Connector Checks

- Use Vercel connector to confirm latest production deployment is `READY` and record deployment id
  and commit sha.
- Use Supabase connector to confirm project health and expected Alembic version.
- Confirm Stripe webhook endpoint matches the expected Stripe mode for the current phase.

## Non-Functional Requirements

- Smoke data must be identifiable as support/test data.
- Smoke sales should use a small known amount.
- Smoke results should include deployment id, commit sha, date, tester, and created order id.

## Acceptance Criteria

- A release is not considered production-validated until all required checks pass or a documented
exception is accepted.
- A release is not considered paid-beta-ready until the smoke is rerun with
  `PRODUCTION_SMOKE_STRIPE_MODE=live`.
- Any failed check creates a backlog item with severity and owner.

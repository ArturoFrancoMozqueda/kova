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
- Stripe Checkout opens in live mode for production validation.
- Login works with the support smoke account.
- Register can complete a small cash sale.
- Order detail receipt opens for the created sale.
- Reports include the created sale for the selected date.
- Vercel latest production deployment is `READY`.
- Supabase project is healthy and Alembic version matches expected release notes.

## Non-Functional Requirements

- Smoke data must be identifiable as support/test data.
- Smoke sales should use a small known amount.
- Smoke results should include deployment id, commit sha, date, tester, and created order id.

## Acceptance Criteria

- A release is not considered production-validated until all required checks pass or a documented
exception is accepted.
- Any failed check creates a backlog item with severity and owner.

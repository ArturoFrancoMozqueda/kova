# Stripe Checkout Spec

## Problem

Tenant owners need a safe way to subscribe to the Standard Plan without the app handling card details directly.

## Target Users

- Tenant owner

## Business Value

Stripe Checkout gives the beta a sellable billing path while keeping payment collection outside the POS application.

## Functional Requirements

- A tenant owner with `billing.manage` can start checkout from the billing settings page.
- Checkout uses the configured Stripe Price for Standard Plan.
- Checkout mode is `subscription`.
- Checkout currency and amount must correspond to $299 MXN/month.
- Launch-ready public checkout must use live Stripe keys, a live Stripe Price, and a live Checkout Session.
- Test-mode Checkout Sessions are allowed in local, CI, staging-like validation environments, and
  explicitly approved pre-launch production demos.
- Pre-launch production sandbox mode must be enabled intentionally with
  `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION=true`.
- Public selling must set `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION=false` after the web app is complete.
- The checkout session is associated with the tenant through metadata.
- The checkout session is associated with the authenticated user where useful for audit/support.
- Success and cancel URLs return the tenant owner to billing UI states.
- The app does not mark a subscription active from the frontend return alone; verified webhooks are source of truth.

## Non-Functional Requirements

- Stripe secret keys never reach the frontend.
- Checkout session creation is tenant-scoped.
- Checkout session creation logs `tenant_id`, `user_id`, and `request_id`.

## Permissions

- Requires `billing.manage`.

## Idempotency

- Retrying the same checkout start request should not create inconsistent local billing state.
- Stripe idempotency keys should include tenant and request identity where practical.

## Audit Log Behavior

- Successful checkout session creation writes `billing.checkout_started`.

## Offline Impact

- Online only.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- Tenant with `active` subscription receives current subscription response instead of a duplicate checkout flow.
- Missing Stripe price configuration returns `503`.
- Production configured with a Stripe test key or test price returns a configuration failure before
  checkout unless pre-launch sandbox mode is explicitly enabled.
- Stripe API failure returns `502` or `503` with retry guidance.

## Data Model Impact

- May store last checkout session id on the tenant subscription record if useful for reconciliation.

## API Impact

- `POST /api/v1/billing/checkout`

## Acceptance Criteria

- Tenant owner receives a Stripe Checkout URL for the Standard Plan.
- Production checkout URL may stay in sandbox while the app is pre-launch and intentionally configured
  with `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION=true`.
- Launch-ready public checkout URL is live mode and must not contain a `cs_test` session id.
- Pre-launch production sandbox checkout may contain a `cs_test` session id only while
  `STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION=true`.
- Non-owner without billing permission cannot start checkout.
- Tenant B cannot create or view checkout state for Tenant A.
- Frontend success state tells the user billing is being confirmed if the webhook has not arrived yet.

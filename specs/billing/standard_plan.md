# Standard Plan Billing Spec

## Problem

The product needs a simple paid subscription model before closed beta tenants can pay for continued access.

## Target Users

- Tenant owner
- Internal support/admin operator

## Business Value

A single paid plan validates willingness to pay while avoiding pricing-tier complexity during beta.

## Functional Requirements

- The only public plan is `Standard Plan`.
- The price is exactly $199 MXN/month.
- All user-facing billing, dashboard, onboarding, landing, and checkout copy must show the same $199 MXN/month price.
- The plan includes all currently available features.
- There are no Basic, Pro, Premium, annual, per-user, per-location, usage-based, or add-on plans in v1.
- Feature flags may hide unfinished/internal modules but must not create paid tiers.
- Each tenant has at most one current subscription record.
- Subscription status supports `incomplete`, `trialing`, `active`, `past_due`, `canceled`, and `unpaid` if Stripe emits it.
- Normal beta access is allowed for `trialing` and `active`.
- `past_due` enters the recovery behavior defined in `specs/billing/past_due.md`.
- `canceled` enters the access behavior defined in `specs/billing/cancellation.md`.

## Non-Functional Requirements

- Billing records are tenant-scoped.
- Store money as integer minor units and currency code from Stripe where possible.
- Do not use floats in money paths.
- Store timestamps in UTC.
- Stripe identifiers are stored as opaque strings.
- Stripe secrets are read only from environment/secrets manager.

## Permissions

- Billing management requires `billing.manage`.
- Billing read access requires `billing.view`.
- Internal/admin subscription visibility must not bypass tenant isolation for normal tenant users.

## Idempotency

- Stripe webhook handling is idempotent through `webhook_events`.
- Checkout creation should use Stripe idempotency keys when retrying the same tenant checkout request.

## Audit Log Behavior

- Successful checkout session creation writes `billing.checkout_started`.
- Subscription activation/update/cancellation from webhooks writes billing audit events.
- Manual cancellation writes `billing.subscription_cancel_requested`.

## Offline Impact

- Billing is online only in Sprint 9.
- Offline POS sale capture must not depend on live billing checks once a tenant has a cached allowed status.

## Error States

- Missing auth returns `401`.
- Missing billing permission returns `403`.
- Missing Stripe configuration returns `503`.
- Stripe API failure returns a safe user-facing retry state.

## Data Model Impact

- Add `subscriptions`.
- Add `webhook_events`.

## API Impact

- `GET /api/v1/billing/subscription`
- `POST /api/v1/billing/checkout`
- `POST /api/v1/billing/cancel`
- `POST /api/v1/billing/webhooks/stripe`

## Acceptance Criteria

- A tenant owner can see the Standard Plan price as $199 MXN/month.
- A tenant cannot see another tenant's subscription.
- The system never exposes multiple paid plan choices in v1.
- Subscription status is updated only through tenant-scoped service logic or verified Stripe webhooks.

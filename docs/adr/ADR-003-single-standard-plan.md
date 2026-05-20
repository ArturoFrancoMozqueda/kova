# ADR-003: Single Standard Plan at $299 MXN/month

## Status

Accepted

## Context

The product needs subscription billing, but the initial goal is to validate willingness to pay.

Multiple plans would introduce complexity in product packaging, billing, UI, feature gating, support, and testing.

## Decision

Launch v1 / beta with one plan:

- Standard Plan
- $299 MXN/month
- all currently available features included

No Basic / Pro / Premium tiers in v1.

No per-user pricing.

No per-location pricing.

No add-ons.

No usage-based billing.

## Consequences

### Positive

- Easier to sell.
- Easier to explain.
- Easier to build.
- Easier to test.
- Avoids premature packaging decisions.

### Negative

- Less pricing segmentation.
- Heavy users and light users pay the same.
- Future migration to tiers may require communication.

## Rules

- Use Stripe Billing / Checkout.
- Subscription states include trialing, active, past_due, canceled.
- Feature flags may hide unfinished modules.
- Feature flags must not create paid tiers in v1.

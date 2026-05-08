# Deferred Scope

This document protects the product from scope creep.

If a feature is listed here, do not implement it unless explicitly moved into the active sprint and approved.

## Deferred From Closed Beta

The closed beta should focus on a reliable bakery / small food retail POS.

Do not implement these for beta:

- Multiple pricing tiers
- Basic / Pro / Premium plans
- Plan-based feature gates
- Per-user pricing
- Per-location pricing
- Annual plans
- Add-ons
- Usage-based billing
- Multi-location
- KDS
- Tables / floor plan
- Appointments
- Loyalty
- Promotions engine
- Public API
- Webhooks
- Custom roles UI
- Stripe Terminal
- Hardware printer SDKs
- Advanced report builder
- Multi-currency
- White-label
- SSO
- Enterprise features
- Full restaurant production support
- Full salon production support
- Full clinic production support

## Deferred Until After Core POS Stability

These can be considered after the core flow is stable with beta tenants:

- Modifiers
- Tax engine
- Discounts
- Retail preset
- Restaurant preset
- Stronger reporting
- More advanced inventory
- Product CSV import wizard
- Receipt template editor
- Customer records
- Store credit
- Advanced employee permissions

## Deferred Until Post-GA

These should not be considered until there is real usage, support capacity, and revenue signal:

- Multi-location
- Stripe Terminal
- KDS
- Tables/floor plan
- Appointments
- Loyalty
- Promotions
- Public API
- Webhooks
- White-label
- SSO
- SCIM
- Enterprise admin
- Franchise hierarchy
- Multi-currency
- Marketplace/plugins
- AI features

## Explicit Non-Goals for v1

- Becoming a full restaurant platform from day one.
- Competing with enterprise POS systems.
- Supporting complex tax jurisdictions before beta.
- Supporting hardware ecosystems before the core POS works.
- Building microservices.
- Creating an app marketplace.
- Supporting every possible business type in beta.

## Rule

A deferred feature can only move into scope if:

1. There is a written Feature Spec.
2. It is added to `docs/current-sprint.md`.
3. It does not break the north star flow.
4. It does not delay beta-critical work.
5. It has clear BDD scenarios and acceptance criteria.

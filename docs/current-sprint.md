# Current Sprint

## Active Sprint

Sprint: 9 - Billing: Standard Plan

## Sprint Goal

Make the product sellable through a single `Standard Plan` subscription at $199 MXN/month using Stripe Billing and Stripe Checkout.

## Required Specs

- `specs/billing/standard_plan.md`
- `specs/billing/checkout.md`
- `specs/billing/webhooks.md`
- `specs/billing/past_due.md`
- `specs/billing/cancellation.md`

## Required BDD / Test Scenarios

- Tenant owner starts checkout for the Standard Plan.
- Tenant returns from successful checkout and sees active or pending subscription state.
- Stripe webhook activates a tenant subscription idempotently.
- Duplicate webhook delivery does not duplicate subscription state changes.
- Tenant in `past_due` sees billing recovery guidance.
- Tenant owner cancels subscription.
- Non-owner cannot manage billing.
- Tenant B cannot see or update Tenant A's subscription.

## Allowed Work

Only work on:

- Standard Plan subscription data model
- Stripe Checkout session creation
- Stripe Billing subscription status handling
- Stripe webhook signature verification
- Stripe webhook idempotency
- Billing settings page
- Billing status and past_due UI states
- Cancellation flow
- Tenant-scoped billing queries
- Permission gate for billing management
- Billing audit logs
- Backend and frontend tests

## Explicitly Not Allowed This Sprint

Do not implement:

- Multiple pricing tiers
- Annual plans
- Per-user pricing
- Per-location pricing
- Usage-based billing
- Add-ons
- Feature-gated paid tiers
- Stripe Terminal
- POS customer payment processing through Stripe
- Tax engine
- Public marketing pricing page unless explicitly pulled into scope
- Deferred scope from `docs/deferred-scope.md`

## Sprint 9 Tasks

### Backend

- [ ] Create `subscriptions` table.
- [ ] Create `webhook_events` table.
- [ ] Add Stripe Checkout integration.
- [ ] Add Stripe Billing integration.
- [ ] Add webhook signature verification.
- [ ] Add webhook idempotency.
- [ ] Add subscription status model.
- [ ] Add grace period logic.
- [ ] Add cancellation flow.
- [ ] Add internal/admin subscription visibility.
- [ ] Ensure Standard Plan price is $199 MXN/month.
- [ ] Remove/defer plan-based feature gates.
- [ ] Add tenant scoping for all billing queries.
- [ ] Add permission checks for billing management.
- [ ] Add audit logs for billing mutations.

### Frontend

- [ ] Add billing settings page.
- [ ] Add checkout start UI.
- [ ] Add checkout success/cancel return states.
- [ ] Add current subscription status UI.
- [ ] Add past_due banner.
- [ ] Add cancellation flow UI.
- [ ] Add loading/error/empty states.
- [ ] Add permission-based UI gating.

### Tests

- [ ] Add billing BDD scenarios.
- [ ] Add backend billing integration coverage.
- [ ] Add webhook signature and idempotency tests.
- [ ] Add tenant isolation tests for billing.
- [ ] Add permission tests for billing management.
- [ ] Add frontend billing UI E2E tests.

## Definition of Done

- Linked specs exist and are up-to-date.
- Linked BDD scenarios pass.
- Test matrix exists.
- Standard Plan exists in Stripe at $199 MXN/month.
- Checkout creates a subscription for the authenticated tenant.
- Webhooks are signature-verified and idempotent.
- Subscription status is tenant-scoped and permission-gated.
- `past_due` and cancellation behavior match the specs.
- Billing mutations write audit logs.
- Billing UI has loading/empty/error states and permission gating.
- Quality gates pass.

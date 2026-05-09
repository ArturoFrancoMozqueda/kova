# Subscription Cancellation Spec

## Problem

Tenant owners need a controlled way to cancel their subscription, and the system needs predictable access behavior afterward.

## Target Users

- Tenant owner
- Internal support/admin operator

## Business Value

Cancellation is required for trustworthy billing and reduces manual support burden.

## Functional Requirements

- A tenant owner with `billing.manage` can request cancellation.
- Cancellation uses Stripe Billing as the source of truth.
- Sprint 9 cancellation should default to cancel at period end unless product explicitly decides immediate cancellation.
- The UI shows cancellation status and current period end.
- Re-subscribing after cancellation should use the normal checkout path.
- Cancellation must not delete tenant operational data.

## Non-Functional Requirements

- Store timestamps in UTC.
- Show period end using tenant timezone.
- Logs include `tenant_id`, `user_id`, and `request_id`.

## Permissions

- Requires `billing.manage`.

## Idempotency

- Repeated cancellation requests should return the current cancellation state without duplicate Stripe side effects.
- Duplicate Stripe cancellation webhooks are idempotent.

## Audit Log Behavior

- User-requested cancellation writes `billing.subscription_cancel_requested`.
- Stripe-confirmed cancellation writes `billing.subscription_canceled`.

## Offline Impact

- Online only.
- Offline queue recovery must not delete or corrupt tenant data after cancellation.

## Error States

- Missing auth returns `401`.
- Missing permission returns `403`.
- No active subscription returns a no-op current state response.
- Stripe API failure returns retry guidance.

## Data Model Impact

- `subscriptions` stores `cancel_at_period_end`, `canceled_at`, and `current_period_end`.

## API Impact

- `POST /api/v1/billing/cancel`

## Acceptance Criteria

- Tenant owner can request cancellation.
- Non-owner cannot cancel.
- Tenant B cannot cancel Tenant A's subscription.
- Canceled subscription state is visible in billing settings.

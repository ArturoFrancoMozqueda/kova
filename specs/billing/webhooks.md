# Stripe Webhooks Spec

## Problem

Subscription status must be updated from verified Stripe events without duplicate or forged state changes.

## Target Users

- System
- Internal support/admin operator

## Business Value

Reliable webhooks keep tenant access aligned with real subscription status and make billing support diagnosable.

## Functional Requirements

- The Stripe webhook endpoint verifies the Stripe signature before parsing events as trusted.
- Unsupported events are recorded or ignored safely without failing repeatedly.
- Relevant events update the tenant subscription:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- Event metadata must map the Stripe object back to a tenant.
- Webhook processing stores the Stripe event id.
- Duplicate event delivery returns success without duplicating side effects.
- Subscription status changes are applied through the billing service layer.

## Non-Functional Requirements

- Webhook processing is tenant-scoped after tenant resolution.
- Raw webhook secret is read from environment/secrets manager only.
- Logs include `request_id`, resolved `tenant_id` when available, and Stripe event id.
- Webhook handlers must avoid floats in money logic.

## Permissions

- Public Stripe webhook endpoint does not require user auth.
- It requires valid Stripe signature.

## Idempotency

- `webhook_events.stripe_event_id` is unique.
- Duplicate event ids do not duplicate subscription writes or audit logs.

## Audit Log Behavior

- Subscription activation writes `billing.subscription_activated`.
- Status updates write `billing.subscription_status_updated`.
- Cancellation writes `billing.subscription_canceled`.
- Failed payment writes `billing.payment_failed`.

## Offline Impact

- Online server-side only.

## Error States

- Invalid signature returns `400`.
- Missing tenant metadata returns `202` or controlled failure with event recorded for manual review.
- Duplicate event returns `200`.
- Transient database errors may return `500` so Stripe retries.

## Data Model Impact

- Add `webhook_events` with Stripe event id, event type, processing status, timestamps, and optional error reason.

## API Impact

- `POST /api/v1/billing/webhooks/stripe`

## Acceptance Criteria

- Verified checkout completion can activate a tenant subscription.
- Duplicate webhook delivery is idempotent.
- Invalid signatures cannot mutate billing state.
- Tenant B subscription cannot be updated by Tenant A event metadata.

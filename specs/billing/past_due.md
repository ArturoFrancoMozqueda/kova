# Past Due Billing Spec

## Problem

Tenants need clear recovery guidance when Stripe reports failed subscription payment.

## Target Users

- Tenant owner
- Manager
- Cashier
- Internal support/admin operator

## Business Value

Past-due handling protects revenue while avoiding surprise disruption during beta operations.

## Functional Requirements

- When Stripe reports payment failure, subscription status becomes `past_due`.
- Tenant owners and users with `billing.view` can see current billing status.
- Tenant owners and users with `billing.manage` can open billing recovery/checkout guidance.
- The UI shows a persistent past_due banner for authenticated users in the tenant.
- The banner copy is user-facing and must use i18n.
- A configurable grace period allows normal POS operation while payment is recovered.
- After grace period expiry, paid write-heavy flows are blocked according to
  `specs/billing/access_control.md`.
- Offline sale capture should continue to protect already-started sales where possible.

## Non-Functional Requirements

- Store all timestamps in UTC.
- Evaluate display dates using tenant timezone.
- Do not block local/offline sale queue recovery solely because the UI is temporarily offline.

## Permissions

- `billing.view` can read status.
- `billing.manage` can start recovery actions.

## Idempotency

- Repeated `invoice.payment_failed` events do not create duplicate banners, audit logs, or status transitions beyond the latest Stripe state.

## Audit Log Behavior

- First transition into `past_due` writes `billing.payment_failed`.
- Grace period expiry, if implemented, writes `billing.grace_period_expired`.

## Offline Impact

- Billing recovery is online only.
- Existing offline queue records must remain recoverable after reconnect.

## Error States

- Missing auth returns `401`.
- Missing permission to manage billing hides recovery actions but may still show a limited contact-owner message.
- Stripe customer portal/checkout creation failure shows retry state.

## Data Model Impact

- `subscriptions` stores `status`, `current_period_end`, `past_due_at`, and optional `grace_period_ends_at`.

## API Impact

- `GET /api/v1/billing/subscription`
- `POST /api/v1/billing/checkout`

## Acceptance Criteria

- Tenant in `past_due` sees a recovery banner.
- Non-owner cannot manage payment recovery.
- `past_due` status is tenant-scoped.
- Grace period behavior is deterministic and test-covered before enforcement.
- Expired grace returns `402 Payment Required` for paid write-heavy flows while billing recovery
  remains available.

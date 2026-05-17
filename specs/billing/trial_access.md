# Trial Access Spec

## Problem

New tenants need enough time to evaluate the POS before paying, but the product must not be usable
forever without an active subscription.

## Target Users

- Tenant owner
- Manager
- Cashier
- Internal support/admin operator

## Business Value

A deterministic trial lets beta tenants reach first sale without manual database work while keeping
the commercial model enforceable.

## Functional Requirements

- A tenant without a subscription receives a 14-day trial starting from `tenants.created_at`.
- Trial access applies to the full current POS core; there are no feature-tier restrictions.
- Stripe `trialing` subscription status is also treated as allowed access.
- The billing status API must return whether the tenant is `allowed`, `trialing`, and/or `blocked`.
- The billing status API must include `trial_ends_at` for no-subscription trial tenants.
- Trial expiry blocks paid write-heavy business flows until billing is recovered.
- Owners can still open billing and start checkout when trial access has expired.
- Read-only operational recovery remains available for receipts, reports, order history, and billing.

## Non-Functional Requirements

- Trial evaluation uses UTC timestamps.
- Trial length is configurable by environment for tests and future policy changes.
- No pricing tiers or feature-gated plans are introduced.

## Permissions

- Trial state is tenant-wide and does not replace RBAC.
- Users must still have their normal RBAC permission for the operation they are attempting.
- Billing recovery requires `billing.manage`.

## Tenant-Scoping Impact

- Trial access is calculated from the authenticated membership tenant only.
- A tenant must never be able to infer another tenant's trial or subscription state.

## Idempotency Impact

- Blocked writes fail before business write idempotency records are created.
- Retrying a blocked write after subscription recovery should behave like a fresh valid request.

## Audit Log Behavior

- A blocked paid write attempt writes `billing.access_blocked` with route, role, and reason.
- Successful trial reads do not write audit logs.

## Offline Impact

- Existing offline queue records remain stored locally.
- Syncing queued sales after trial expiry is blocked until billing is recovered.
- A future offline grace cache may be added, but this spec does not introduce local access tokens.

## Error States

- Expired trial with no subscription returns `402 Payment Required`.
- Canceled, unpaid, incomplete, or expired past-due access returns `402 Payment Required`.
- Missing authentication still returns `401`.
- Missing RBAC permission still returns `403`.

## Data Model Impact

- No migration for the first implementation.
- Trial start is derived from `tenants.created_at`.
- Subscription records remain in `subscriptions`.

## API Impact

- `GET /api/v1/billing/subscription` adds an `access` object:
  - `allowed`
  - `reason`
  - `trialing`
  - `trial_ends_at`
  - `blocked_at`
  - `recovery_path`

## Test Matrix

| Scenario | Layer | Expected Result |
|---|---|---|
| No subscription inside 14-day trial | Backend | Paid writes are allowed and billing access shows trialing |
| No subscription after trial expiry | Backend | Paid writes return `402` and audit `billing.access_blocked` |
| Stripe `active` subscription | Backend | Paid writes are allowed |
| Stripe `trialing` subscription | Backend | Paid writes are allowed |

## Acceptance Criteria

- New tenants can use the POS during the trial without manual support intervention.
- Trial expiry produces a clear billing recovery state.
- No tenant can use paid write flows indefinitely without trial, grace, or active subscription.

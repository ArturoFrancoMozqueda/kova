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

- A tenant without a subscription receives a 7-day trial starting from `tenants.created_at`.
- Trial access applies to the full current POS core; there are no feature-tier restrictions.
- Stripe `trialing` subscription status is also treated as allowed access.
- The billing status API must return whether the tenant is `allowed`, `trialing`, and/or `blocked`.
- The billing status API must include `trial_ends_at` for no-subscription trial tenants.
- During active trial, the dashboard shows a value recap with sales count, collected amount,
  active catalog count, active team count, closed shifts, and best sales day.
- Trial expiry blocks commercial reads and writes until billing is recovered.
- Owners can still open billing and start checkout when trial access has expired.
- Billing recovery, authentication, account export/deletion and privacy/security revocation remain
  available. Operational reads such as receipts, reports and order history require commercial access.

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
- Offline continuity uses a previously verified commercial grant, not an auth token. The grant
  expires at the earlier of 12 hours and the server's commercial deadline; an HTTP 402 clears it
  while preserving all queued sales for later recovery.

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
  - `valid_until`
- `GET /api/v1/auth/session` includes `{allowed, reason, valid_until}` in `commercial_access`
  for every authenticated role, including employees without billing-management permission.

## Test Matrix

| Scenario | Layer | Expected Result |
|---|---|---|
| No subscription inside 7-day trial | Backend | Paid writes are allowed and billing access shows trialing |
| No subscription after trial expiry | Backend | Paid writes return `402` and audit `billing.access_blocked` |
| Stripe `active` subscription | Backend | Paid writes are allowed |
| Stripe `trialing` subscription | Backend | Paid writes are allowed |

## Acceptance Criteria

- New tenants can use the POS during the trial without manual support intervention.
- Trialing tenants can see what Kova has already captured for the business before activating billing.
- Trial expiry produces a clear billing recovery state.
- No tenant can use paid write flows indefinitely without trial, grace, or active subscription.

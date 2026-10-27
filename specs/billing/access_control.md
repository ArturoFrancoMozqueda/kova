# Billing Access Control Spec

## Problem

The POS currently exposes core business write flows without a commercial access check. A tenant can
continue creating sales, catalog items, inventory adjustments, and shifts even when no subscription
or valid trial exists.

## Target Users

- Tenant owner
- Manager
- Cashier
- Internal support/admin operator

## Business Value

Commercial access control makes the $299 MXN/month Standard Plan enforceable while still allowing
owners to recover billing without losing operational visibility.

## Functional Requirements

- Commercial access is tenant-wide.
- Allowed access states:
  - No subscription and trial not expired.
- Stripe subscription status `trialing` with a current finite trial deadline.
- Stripe subscription status `active` with a current paid period and a verified snapshot no older
  than 24 hours. Expired/missing periods trigger an authoritative Stripe lookup; an unverified
  state remains blocked without inventing a cancellation.
  - Stripe subscription status `past_due` while the known first failure's 48-hour
    deadline and `grace_period_ends_at` are both in the future.
- Blocked access states:
  - No subscription and trial expired.
  - `incomplete`.
  - `canceled`.
  - `unpaid`.
  - `past_due` with no proven first failure, no grace end or expired grace.
- Blocked tenants cannot read or write any commercial module, including:
  - Create orders, including offline sale sync.
  - Create/update/delete catalog data and modifiers.
  - Inventory adjustments, stock takes, and low-stock threshold updates.
  - Open shifts, close shifts, and record cash movements.
- Blocked tenants retain only authentication/session security, billing recovery and cancellation,
  account export/deletion, assistant export/privacy deletion and consent controls, and credential
  revocation. Historical orders, reports, catalog, inventory, assistant and configuration modules
  are commercial access too. Existing permission/ownership checks still apply to recovery routes.
- `past_due` access lasts at most 48 hours from the first failure. Existing longer grace settings
  or stored deadlines cannot extend this limit, and repeated failures never restart the clock.
- The block response must include a safe message and the billing recovery path.

## Non-Functional Requirements

- Access checks must run after authentication and RBAC checks.
- Access checks must be centralized, not scattered inline in route handlers.
- Access checks must not introduce plan-tier or feature-tier logic.

## Permissions

- RBAC remains the first authorization layer.
- Commercial access is a second gate for commercial reads and writes. The common authenticated
  session dependency applies it by default, using the explicit route-template recovery allowlist
  in `backend/app/billing/policy.py`. Permission metadata preserves RBAC-first failures.
- A user without the underlying RBAC permission receives `403`, not a billing block.

## Tenant-Scoping Impact

- Access is calculated from the current membership tenant.
- Billing status lookups must query by `tenant_id`.

## Idempotency Impact

- Blocked write attempts must fail before creating business records.
- Existing idempotency responses for allowed writes are unchanged.

## Audit Log Behavior

- Blocked paid writes write `billing.access_blocked`.
- The audit payload includes `reason`, `path`, `method`, and `role`.
- Commercial reads blocked by the central gate also write the same minimal audit event.

## Offline Impact

- Offline sale sync is a paid write and is blocked when access is blocked.
- Local queue recovery can resume after the tenant subscribes or access is restored.
- A verified offline grant expires at the earlier of 12 hours and `commercial_access.valid_until`.
  Missing or denied commercial state cannot prepare an offline grant. A live page also expires;
  an HTTP 402 revokes the cached grant but preserves queued sales and their UUIDs for recovery.

## Error States

- `402 Payment Required`: authenticated and RBAC-allowed user lacks commercial access.
- `401 Unauthorized`: no valid session.
- `403 Forbidden`: missing RBAC permission.
- `402 Payment Required`, reason `verification_required`: the subscription cannot be verified with
  a current paid period; the recovery/account surfaces remain reachable.

## Data Model Impact

- No migration for the first implementation.
- Future iterations may add explicit tenant trial fields if support needs manual trial extension.

## API Impact

- `GET /api/v1/billing/subscription` returns access state and its finite `valid_until`.
- `GET /api/v1/auth/session` returns additive `commercial_access: {allowed, reason, valid_until}`
  for every authenticated role. A blocked account remains authenticated to recover billing and
  exercise data rights; this does not grant commercial API access.
- Paid write endpoints may return `402` with:
  - `detail`
  - `reason`
  - `recovery_path`

## Test Matrix

| Scenario | Layer | Expected Result |
|---|---|---|
| Active subscription creates order | Backend integration | `201` order response |
| Expired trial creates order | Backend integration | `402` and `billing.access_blocked` audit |
| Expired trial starts checkout | Backend integration | Checkout is allowed |
| Expired trial reads receipt/report | Backend integration | `402`; export remains available |
| Cashier without permission attempts restricted write | Backend integration | `403`, not `402` |

## Acceptance Criteria

- Commercial reads/writes require a current seven-day trial, verified paid subscription, or
  unexpired 48-hour payment grace. Trial/grace boundaries are exclusive at expiry.
- Billing recovery remains reachable while blocked.
- All enforcement is centralized and tenant-scoped.

## Public and private worker entrypoints

- Public catalog reads and anonymous order requests resolve publication, tenant activity and
  current commercial access before returning catalog data or recording a request; unavailable
  businesses return the existing 404 state without exposing billing details.
- Stripe webhooks retain their independent signature, mode, idempotency and temporal validation;
  they must remain reachable to restore or cancel commercial access.
- Verified WhatsApp ingress may acknowledge and retain incoming messages/delivery receipts so
  third-party messages are not lost. It does not send replies or create paid operational orders;
  outbound delivery checks commercial access again before any external effect.
- Automation, follow-up, loyalty, assistant generation/ingestion and notification workers use
  the same current billing-state evaluator before effects. A retained queued job is not access.
- Existing public raster product images and receipt logos remain public assets under their
  established contract, independent of the private application. They expose no private analytics
  or operational actions. Versioned raster edge freshness remains bounded to five minutes;
  uploads, changes and private module reads require current commercial access.
- Device pairing does not itself authorize drawer operations: authenticated connector polling
  and commands recheck commercial access under the existing device-key protocol.

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
  - Stripe subscription status `trialing`.
  - Stripe subscription status `active`.
  - Stripe subscription status `past_due` while `grace_period_ends_at` is in the future.
- Blocked access states:
  - No subscription and trial expired.
  - `incomplete`.
  - `canceled`.
  - `unpaid`.
  - `past_due` with no grace end or expired grace.
- Blocked tenants cannot perform paid write-heavy flows:
  - Create orders, including offline sale sync.
  - Create/update/delete catalog data and modifiers.
  - Inventory adjustments, stock takes, and low-stock threshold updates.
  - Open shifts, close shifts, and record cash movements.
- Blocked tenants keep read-only access to:
  - Billing and checkout recovery.
  - Order history and receipts.
  - Reports.
  - Existing catalog/inventory views.
- The block response must include a safe message and the billing recovery path.

## Non-Functional Requirements

- Access checks must run after authentication and RBAC checks.
- Access checks must be centralized, not scattered inline in route handlers.
- Access checks must not introduce plan-tier or feature-tier logic.

## Permissions

- RBAC remains the first authorization layer.
- Commercial access is a second gate for paid writes only.
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
- Blocked reads are not audited.

## Offline Impact

- Offline sale sync is a paid write and is blocked when access is blocked.
- Local queue recovery can resume after the tenant subscribes or access is restored.

## Error States

- `402 Payment Required`: authenticated and RBAC-allowed user lacks commercial access.
- `401 Unauthorized`: no valid session.
- `403 Forbidden`: missing RBAC permission.
- `503 Service Unavailable`: billing status cannot be evaluated because required data is unavailable.

## Data Model Impact

- No migration for the first implementation.
- Future iterations may add explicit tenant trial fields if support needs manual trial extension.

## API Impact

- `GET /api/v1/billing/subscription` returns access state.
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
| Expired trial reads receipt/report | Backend integration | Read endpoint remains available |
| Cashier without permission attempts restricted write | Backend integration | `403`, not `402` |

## Acceptance Criteria

- Paid writes require trial, active subscription, or active grace.
- Billing recovery remains reachable while blocked.
- All enforcement is centralized and tenant-scoped.

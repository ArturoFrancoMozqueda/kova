# First Sale Onboarding Spec

## Status

Implemented foundation; Sprint 2 refinement in progress.

## Problem

A new cafe, bakery, or small food retail tenant signs up but has no guided path from account creation to
first real sale. Setup state (business profile, products, shift, sale, billing) is implicit and
scattered across modules. Owners cannot tell what is left to do or where to do it.

## Target Users

- Tenant owner (primary).
- Manager assisting setup.
- Cashier completing the first sale.

## Business Value

- Reduces founder-assisted onboarding to zero for the beta north-star flow.
- Makes the path from signup to first sale and first invoice measurable.
- Reinforces the Standard Plan value during the trial.

## Functional Requirements

- After verifying email, the new tenant lands on the dashboard with a visible onboarding checklist.
- The checklist surfaces, in order, the steps required to reach first sale:
  1. Configure business profile (public name, support contact, timezone, locale).
  2. Configure receipt settings (receipt business name, footer, tax/contact placeholder, logo hook).
  3. Create the first product.
  4. (Optional) Activate inventory tracking on at least one product.
  5. Open a shift on the register.
  6. Complete the first sale.
  7. Review billing (start checkout or confirm trial status).
- Each checklist step links directly to the action that completes it, not just the module.
- Cafe tenants can explicitly load a tenant-scoped cafe preset with common products such as
  americano, latte, cold brew, pan dulce, sandwiches, and bottled drinks.
- The inventory checklist action opens product creation with inventory tracking enabled when the
  tenant has no tracked products yet.
- Completion is derived from real backend data wherever possible:
  - Business profile: tenant settings record exists and required fields are non-empty.
  - Receipt settings: receipt settings record exists.
  - First product: tenant has at least one active product.
  - Inventory: at least one product has `track_inventory` enabled.
  - Shift opened: at least one shift was opened for the tenant.
  - First sale: tenant has at least one completed order.
  - Billing: subscription is active, trialing, or in past_due grace, OR user has opened the billing
    page at least once during the trial.
- Steps not yet completed remain visible. Completed steps render in a collapsed/checked state.
- After first product, inventory activation, shift opening, first sale, and first report, the UI
  shows a positive milestone state with the next useful action.
- The checklist must be permission-aware: cashiers see only steps they can act on; owners and
  managers see all steps.
- The checklist must not block the rest of the dashboard.

## Non-Functional Requirements

- Checklist evaluation must use a single API round-trip when possible.
- The component must not regress dashboard time-to-interactive beyond +150ms p50.
- All UI strings must be localized via i18n keys.
- Mobile layout: stacks vertically without horizontal overflow at 390px.

## Permissions

- Owner: sees and can complete every step.
- Manager: sees every step; can complete catalog/inventory/shift/sale; cannot complete billing.
- Cashier: sees shift and first-sale steps only.
- All actions still respect RBAC at the API layer; the checklist does not bypass permissions.

## Tenant-Scoping Impact

- Checklist derivation queries must filter by the authenticated membership tenant.
- The onboarding state record, if added, must include `tenant_id` and be RLS-scoped.

## Idempotency Impact

- No new write endpoints in v1 — completion is derived. If an explicit "dismiss step" action is
  added later, it must be idempotent on `(tenant_id, step_id)`.

## Audit Log Behavior

- v1 derives state from existing records, so no new audit events are created.
- If explicit dismissal is added later, log `onboarding.step_dismissed` with `step_id` and `user_id`.

## Offline Impact

- Checklist is read-only and runs against the existing online API. Offline behavior is unchanged:
  if the dashboard cannot reach the API, the checklist shows a non-blocking error and the rest of
  the dashboard renders as today.

## Error States

- API failure: checklist shows retryable error with a Retry button; does not block the dashboard.
- Partial data: any step whose source data fails to load renders as "status unknown" with a Retry
  affordance on that step only.
- Permission denied on a derivation source: the dependent step is hidden, not shown as failed.

## Data Model Impact

- Preferred v1: derive state from existing tables (`tenant_settings`, `receipt_settings`,
  `products`, `shifts`, `orders`, `subscriptions`) without a new table.
- If explicit dismissal is required, add `tenant_onboarding_state(tenant_id, step_id,
  completed_at, dismissed_at, updated_by)` with tenant-scoped RLS.

## API Impact

- New: `GET /api/v1/onboarding/state` returns a derived snapshot per current tenant:
  - `steps`: array of `{ id, completed, action_path, required_permission }`.
  - `next_step_id`: first uncompleted, permission-allowed step.
  - `evaluated_at`: ISO timestamp.
- Existing endpoints used as sources:
  - `GET /api/v1/settings/business-profile`
  - `GET /api/v1/settings/receipt`
  - `GET /api/v1/catalog/products?limit=1`
  - `GET /api/v1/inventory/stock?tracked=true&limit=1`
  - `GET /api/v1/shifts?limit=1`
  - `GET /api/v1/orders?status=completed&limit=1`
  - `GET /api/v1/billing/subscription`

## Acceptance Criteria

- A new tenant who has just verified email can identify the next setup action within 5 seconds of
  landing on the dashboard.
- Completing each step from its checklist link advances the checklist on next load.
- Completed first-value milestones show a success state instead of only changing a checkbox.
- Reaching "First sale" complete also marks the tenant ready for billing.
- The checklist works on mobile (390px) and respects cashier/manager/owner permissions.
- No checklist step depends on data the backend cannot return.
- Preset data is never inserted automatically; it is only created after the user explicitly clicks a
  preset option.

## Test Matrix

See `docs/test-matrixes/onboarding.md`.

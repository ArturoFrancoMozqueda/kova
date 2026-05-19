# Commercial UX Trust Fixes

## Problem

Prospective beta tenants must be able to understand the product value, configure the POS, review payments, and decide whether to subscribe without seeing contradictory financial information, mixed-language copy, or misleading empty-state metrics.

## Target Users

- Business owner evaluating whether to pay for Kova.
- Manager configuring catalog, employees, receipts, and inventory.
- Cashier completing sales from the register.

## Business Value

These fixes increase trust, subscription conversion, onboarding completion, and retention by making the beta feel honest, premium, and operationally useful without adding deferred product scope.

## Functional Requirements

- Billing must describe the single Standard Plan in Spanish and show one coherent access state.
- Expired trial accounts must see a clear recovery CTA and the operational value unlocked by payment.
- Dashboard comparisons must not show percentage deltas when there is no valid baseline.
- Business health must not mark a new/no-activity business as critical only because there is no activity.
- Onboarding checklist labels must be business-friendly Spanish and guide users toward first sale readiness.
- Receipts must distinguish total paid from cash tendered/change and avoid showing cash-only fields for non-cash-only orders.
- Product setup copy must be Spanish and explain SKU, inventory, and how the product appears in the register.
- Settings must avoid raw technical role labels where possible.
- Signup must communicate trial, price, no-card expectation, and legal/trust cues.
- Mobile blocking banners must be compact enough to preserve register usability.

## Non-Functional Requirements

- No demo data may be introduced.
- No deferred features may be promised as currently available.
- User-facing copy must remain localizable through the existing `copy` object.
- Money display must remain deterministic and use MXN formatting.

## Acceptance Criteria

- Given a non-cash order, the receipt shows total paid and payment method without showing an incorrect cash tendered amount.
- Given a cash order, the receipt shows total paid, cash received, and change.
- Given a dashboard with no previous-day baseline, KPI cards show "Sin comparación todavía" instead of a percentage.
- Given no orders today, business health shows a neutral setup status rather than "Crítico".
- Given billing access is blocked, the billing page explains the plan value and uses "Activar plan" as the primary CTA.
- Given a new user visits signup, they see trial/price/legal cues before creating an account.
- Given a mobile viewport, billing banners use concise text and do not dominate the first screen.

## Data Model Impact

No database changes.

## API Impact

No API changes.

## Permissions Impact

No permission changes.

## Offline Impact

No offline storage changes. Register copy and mobile affordances must continue to support offline sale queue behavior.

## Error States

Existing loading and error states remain. Billing and dashboard empty states become more explicit and less alarming.

## Audit Log Behavior

No new mutation behavior is introduced.

## Test Coverage

- Frontend unit/build validation for changed components.
- Existing Playwright coverage should continue to pass for billing, register, reports, mobile, and order detail flows.

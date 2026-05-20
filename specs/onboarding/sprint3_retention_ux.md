# Sprint 3 Retention UX

## Status

Ready for implementation from the 2026-05-19 UX review.

## Problem

New tenant owners need guided first-use help in the core screens, settings must be easier to scan on mobile, the dashboard should show operational actions instead of duplicated navigation, and the product needs basic funnel telemetry plus trial nudges that make upgrade value concrete.

## Target Users

- Tenant owners evaluating the trial.
- Managers configuring the store.
- Cashiers completing first sales.

## Business Value

- Improve activation from signup to first product and first sale.
- Make the trial-to-paid value visible before access is blocked.
- Give product operators a tenant-scoped funnel event trail.

## Functional Requirements

- Show a dismissible first-time tour overlay on `/register`, `/catalog`, and `/reports`.
- Split settings into tabs: Perfil, Recibo, Empleados, Avanzado.
- Replace dashboard quick navigation cards with contextual actions: Cerrar turno, Exportar ventas, Imprimir Z.
- Remove the unauthenticated landing theme toggle until authenticated dark mode exists.
- Track funnel events for signup, first product, first sale, trial-chip click, checkout start, and trial-to-paid.
- Show in-app upgrade nudges during trial based on real usage counts.

## Data Model Impact

- Add `telemetry_events` with `tenant_id`, `user_id`, `event_name`, `properties`, `client_event_id`, and timestamps.
- Enable RLS for tenant-scoped telemetry rows.

## API Impact

- Add `POST /api/v1/telemetry/events`.
- Endpoint requires an authenticated session and writes the current session tenant/user only.

## Permissions Impact

- No new RBAC permission. Any authenticated tenant member can record their own UX telemetry event.

## Offline Impact

- Frontend telemetry events may be queued locally and flushed after authentication.
- Telemetry failure must not block POS operations or offline sale queue behavior.

## Error States

- Tour can be dismissed or skipped.
- Telemetry errors are silent best-effort failures.
- Upgrade nudges hide when billing data cannot load.

## Audit Log Behavior

- Telemetry is product analytics, not operational audit. No audit rows are created.

## Acceptance Criteria

- First visit to `/register`, `/catalog`, or `/reports` shows the relevant tour and does not show again after dismissal.
- Settings routes open the matching tab and mobile users can jump between sections without a long scroll.
- Dashboard action cards no longer duplicate sidebar navigation labels.
- Landing nav no longer exposes a theme toggle while the authenticated app is light-only.
- Funnel events persist with tenant/user scope after authentication.
- A trial tenant with completed sales sees an activation nudge tied to their usage.

## Test Matrix

| Scenario ID | Gherkin File | Scenario Name | Layer | Test File | Required By | Automation Status | Notes |
|---|---|---|---|---|---|---|---|
| S3UX-001 | `specs/onboarding/premium_saas_experience.feature` | First-use tour appears once | Component/E2E | Planned | Beta | Planned | LocalStorage dismissal by tenant and route. |
| S3UX-002 | `specs/onboarding/premium_saas_experience.feature` | Settings tabs expose sections | Component/E2E | Planned | Beta | Planned | Routes map to Perfil/Recibo/Empleados/Avanzado. |
| S3UX-003 | `specs/onboarding/premium_saas_experience.feature` | Dashboard contextual actions render | Component/E2E | Planned | Beta | Planned | No duplicate quick nav labels. |
| S3UX-004 | `specs/onboarding/premium_saas_experience.feature` | Funnel telemetry records tenant event | Backend integration | Planned | Beta | Planned | Auth required, tenant from session. |
| S3UX-005 | `specs/onboarding/premium_saas_experience.feature` | Trial usage nudge appears | Component/E2E | Planned | Beta | Planned | Uses real order count and billing state. |

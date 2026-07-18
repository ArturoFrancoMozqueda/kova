# ADR-012: Operating expenses and approximate operating result

## Status

Accepted

## Decision

- Kova stores tenant-scoped operating expenses with a positive MXN amount, a
  business date, an es-MX category key, an optional note, and the creating user.
- Expense categories are `renta`, `nomina`, `servicios`, `transporte`,
  `mantenimiento`, `marketing`, `comisiones`, `impuestos`, and `otro`.
- Owners and managers can create, read, update, and delete expenses. Every
  mutation is idempotent and written to `audit_logs`; RLS remains the primary
  database isolation boundary.
- The business story reports the exact sum of expenses recorded in the selected
  period. The approximate operating result is gross profit minus those recorded
  expenses, and is unavailable whenever gross profit is incomplete.
- The UI calls the result approximate and explicitly states that it is not tax
  profit: unrecorded expenses, depreciation, financing, and fiscal adjustments
  are outside this release.

## Consequences

- Kova never labels net sales as profit and never fills missing product costs.
- Editing or deleting an expense changes later reports, while the audit trail
  preserves who made the mutation and what data was affected.
- Expense capture and reporting are online-only and hidden by the existing
  `margin_reports` tenant feature flag during rollout.

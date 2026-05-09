# Payment Breakdown Report Spec

## Problem

Owners need to understand how customers paid during a selected date range.

## Target Users

- Tenant owner
- Manager

## Business Value

Payment method totals support cash reconciliation and operational review.

## Functional Requirements

- A user with `reports.view_all` can request payment method totals for a date range.
- The breakdown groups by `cash`, `bank_transfer`, and `manual_card`.
- Voided orders are excluded.
- Each row includes method, amount, and payment count.

## Non-Functional Requirements

- Queries are tenant-scoped.
- Money calculations use Decimal.

## Permissions

- Requires `reports.view_all`.

## Idempotency

- Read-only endpoint; not applicable.

## Audit Log Behavior

- Read-only endpoint; no audit log.

## Offline Impact

- Online only in Sprint 8.

## Error States

- End date before start date returns 400.

## Acceptance Criteria

- Split payments contribute to their respective method totals.
- Tenant B cannot see Tenant A's payment totals.

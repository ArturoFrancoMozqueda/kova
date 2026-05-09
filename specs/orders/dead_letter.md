# Dead Letter Spec

## Problem

Offline sync failures must be visible and recoverable instead of silently retrying forever.

## Target Users

- Cashier
- Tenant owner
- Support

## Business Value

Dead-letter visibility reduces data loss risk and gives support enough information to diagnose failed sales.

## Functional Requirements

- Frontend queue marks failed sync attempts as `failed`.
- Failed entries store the last error message and attempt count.
- Failed entries remain locally available for manual retry.
- Manual retry moves a failed entry back to `pending`.

## Non-Functional Requirements

- Do not discard failed sale payloads automatically.
- Avoid storing secrets in local queue payloads.
- Keep error messages concise and support-friendly.

## Permissions

- Retrying a failed sale uses the same authenticated sync endpoint and `orders.create` permission.

## Error States

- Network failure leaves entries retryable.
- Server validation failure marks entries failed with the server detail.

## Acceptance Criteria

- A failed sync response creates a dead-letter queue entry.
- A dead-letter entry can be moved back to pending for retry.

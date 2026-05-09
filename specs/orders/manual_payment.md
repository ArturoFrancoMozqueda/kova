# Manual Payment Record Spec

## Problem

Businesses need to record non-integrated payments, such as bank transfer and manually processed card payments, without Stripe Terminal in beta.

## Target Users

- Cashier
- Manager
- Tenant owner

## Business Value

Manual payment recording lets beta tenants complete real sales while hardware and integrated card processing are deferred.

## Functional Requirements

- Sprint 2 supports `cash`, `bank_transfer`, and `manual_card`.
- Bank transfer and manual card payment amount must equal order total.
- Optional payment reference can be stored for transfer/card records.
- Manual payment records do not process money; they only record that the tenant accepted payment externally.

## Non-Functional Requirements

- Payment amounts use Decimal.
- POS payments remain separate from subscription billing.

## Permissions

- Creating manual payment records through order creation requires `orders.create`.

## Idempotency

- Manual payment records are idempotent through order creation.

## Audit Log Behavior

- Successful order creation with manual payment writes `orders.create`.

## Offline Impact

- Online only in Sprint 2.

## Error States

- Unsupported payment method returns `400`.
- Bank transfer/manual card amount mismatch returns `400`.

## Acceptance Criteria

- A cashier can create a paid order with bank transfer.
- A cashier can create a paid order with manual card.
- Manual card and transfer payment records expose method and reference in the order response.

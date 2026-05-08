# ADR-008: Separate Billing From POS Payments

## Status

Accepted

## Context

The product has two different payment concepts:

1. The business pays us to use the SaaS.
2. The business accepts payments from its own customers.

These should not be mixed.

## Decision

Separate Billing from POS Payments.

Billing:

- Stripe Billing / Checkout
- Standard Plan
- $199 MXN/month

POS Payments for beta:

- Cash
- Bank transfer
- Manual card payment record
- Split payment if feasible

Stripe Terminal is deferred.

## Consequences

### Positive

- Simpler beta.
- Avoids hardware/payment processor complexity.
- Validates SaaS willingness to pay first.
- Keeps POS payment recording flexible.

### Negative

- No integrated card processing at beta.
- Businesses must use external terminal/manual reconciliation.

## Rules

- Billing code lives in billing domain.
- POS payment code lives in payments/orders domain.
- Stripe Terminal must not block beta.

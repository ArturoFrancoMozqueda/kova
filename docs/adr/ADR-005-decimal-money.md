# ADR-005: Decimal-Only Money Handling

## Status

Accepted

## Context

POS systems handle money. Floating point arithmetic can create rounding bugs.

Money bugs directly damage customer trust.

## Decision

Use Decimal or integer minor units for money.

Do not use floats in money modules.

## Consequences

### Positive

- Predictable calculations.
- Safer rounding.
- Easier golden tests.
- Better trust.

### Negative

- Slightly more verbose code.
- Requires serialization discipline.

## Rules

- No float calculations in pricing, payments, refunds, shifts, taxes, or discounts.
- Store currency with orders.
- Use UTC timestamps and tenant timezone for reporting.
- Add golden tests for:
  - cash change
  - split payment
  - refunds
  - shift close
  - discounts
  - taxes

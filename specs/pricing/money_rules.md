# Money Rules Spec

## Problem

POS totals must be deterministic and safe for real transactions.

## Target Users

- Cashier
- Tenant owner
- Engineering

## Business Value

Reliable money handling prevents financial mismatch, support burden, and loss of tenant trust.

## Functional Requirements

- Use `Decimal` for all money calculations.
- Use two fractional digits for Sprint 2 order totals.
- Line total is `unit_price * quantity`, quantized to 0.01.
- Order subtotal equals sum of line totals.
- Sprint 2 has no tax, discounts, tips, or multi-currency behavior.
- Order total equals subtotal in Sprint 2.

## Non-Functional Requirements

- No floats in pricing code paths.
- Database columns use numeric/decimal types.
- API responses serialize money as decimal strings.

## Permissions

- Pricing is invoked through authorized order creation.

## Error States

- Quantity must be a positive integer.
- Payment amount cannot be negative.
- Payment mismatch returns `400`.

## Acceptance Criteria

- `18.50 * 2` returns `37.00`.
- `12.30 + 18.50` returns `30.80`.
- API responses preserve two decimal places.

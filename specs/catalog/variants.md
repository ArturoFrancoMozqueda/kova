# Product Variants Spec

## Sprint 1 Decision

Variants are not implemented in Sprint 1 unless beta catalog setup proves they are needed before first sale.

## Rationale

Bakery and small food retail tenants can start with flat products. Variants add register, inventory, pricing, and receipt complexity that should not block the smallest reliable catalog foundation.

## Future Requirements

- Variants must be tenant-scoped.
- Variant prices must use `Decimal`.
- Variant SKU must be unique per tenant when present.
- Variant writes must use permissions, idempotency, audit logs, and tests.
- Variant inventory impact must be specified before implementation.

## Acceptance Criteria For Deferral

- Sprint 1 product APIs do not introduce variant tables or variant-specific behavior.
- Product model leaves room for future variants without adding deferred complexity now.

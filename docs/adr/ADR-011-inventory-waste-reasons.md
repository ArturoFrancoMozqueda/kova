# ADR-011: Typed Inventory Waste Reasons

## Status

Accepted

## Decision

- `inventory_movements.reason_code` is nullable and limited to `merma`,
  `caducidad`, `robo`, `daño`, `autoconsumo`, and `otro`.
- The existing `reason` remains a required free-text note for manual adjustments.
- Nullable codes preserve compatibility with old clients and existing movements. Kova
  does not infer codes from historical notes.
- The R1 waste report includes only negative movements with a typed reason code.
- Waste value uses the product's latest known cost because movements do not yet carry
  their own cost snapshot. If any affected product has unknown cost, the total is
  unavailable and only the explicitly labeled known subtotal is returned.
- Positive adjustments, sales, refunds, voids, and uncoded legacy corrections are not
  classified as waste.

## Consequences

- Owners can distinguish expiry, theft, damage, self-consumption, and other shrinkage.
- Historical waste valuation may change when the latest product cost changes. A future
  purchasing release may add movement-time cost snapshots without rewriting history.
- No existing offline or inventory payload becomes invalid.

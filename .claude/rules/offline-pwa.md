---
paths:
  - "**/*pwa*"
  - "**/*offline*"
  - "**/*sync*"
  - "**/*dexie*"
  - "**/*service-worker*"
  - "**/*sw*"
  - "**/*cache*"
  - "**/*queue*"
---

# Offline, PWA, and Sync Rules

Kova POS flows may depend on offline-friendly behavior. Sync bugs can create duplicate sales, inventory mismatches, or broken trust.

## Non-negotiables

- Preserve offline sync idempotency.
- Do not create duplicate orders/sales/payments on retry.
- Do not silently drop queued writes.
- Do not cache sensitive data more broadly than existing behavior.
- Do not break PWA update or cache invalidation patterns.
- Do not assume network availability.

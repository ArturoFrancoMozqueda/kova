---
paths:
  - "**/test_*"
  - "**/*test*"
  - "**/__tests__/**/*"
  - "**/*.spec.*"
  - "**/*.test.*"
  - "**/conftest.py"
  - "**/fixtures/**/*"
  - "**/__snapshots__/**/*"
---

# Testing Rules

Tests are product safety rails, not obstacles to bypass.

## Non-negotiables

- Do not change tests, snapshots, fixtures, or expected outputs just to make failures pass.
- Fix implementation first.
- Only update expected behavior when the requested product behavior changed or the existing test is clearly wrong.
- When changing tests, explain why the expected behavior changed.
- Do not delete failing tests unless explicitly asked and justified.
- Do not reduce coverage around auth, billing, tenant isolation, offline sync, or analytics correctness.

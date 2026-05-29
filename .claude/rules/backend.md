---
paths:
  - "backend/**/*"
  - "app/**/*"
  - "api/**/*"
  - "**/*.py"
  - "**/requirements*.txt"
  - "**/pyproject.toml"
  - "**/alembic/**/*"
  - "**/migrations/**/*"
---

# Backend Rules

Kova backend must be safe, predictable, and production-ready.

## Non-negotiables

- Preserve auth, tenant isolation, RLS expectations, billing gates, and Stripe safety.
- Do not expose secrets in logs or API responses.
- Do not trust client-provided tenant/company/business IDs without verification.
- Do not make broad refactors unless explicitly requested.
- Do not change API contracts without updating frontend usage and tests.
- Do not add fake data to production endpoints.

## Database/migrations

Before changing migrations or models:

1. Inspect current schema and migration history.
2. Confirm whether the change is backward compatible.
3. Preserve tenant ownership columns and indexes.
4. Preserve RLS and policy assumptions.
5. Avoid destructive operations unless explicitly requested.

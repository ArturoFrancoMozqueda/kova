---
paths:
  - "backend/**/*"
  - "**/*.py"
  - "**/pyproject.toml"
  - "**/uv.lock"
  - "**/alembic/**/*"
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

1. Inspect current schema and migration history in `backend/alembic/versions/`.
2. Confirm the change is backward compatible with the previous app version: a release rollback never downgrades the database.
3. Every migration needs a working `downgrade()`; CI runs upgrade → downgrade → upgrade.
4. Preserve tenant ownership columns and indexes.
5. Preserve forced RLS: production refuses to start if a tenant table lacks it.
6. Avoid destructive operations unless explicitly requested.
7. Money is `Decimal`, never `float`.
8. If an endpoint changes, regenerate `specs/openapi.json` with `uv run python scripts/export_openapi.py`.

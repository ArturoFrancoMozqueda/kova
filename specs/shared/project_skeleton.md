# Spec — Project Skeleton (Sprint 0A)

## Problem Statement

The repository contains governance docs but no runnable code. Future sprints cannot deliver product features safely without a baseline application skeleton, local dev workflow, migration tooling, and CI. Sprint 0A delivers exactly that and nothing more.

## Scope

**In scope:**

- Repository directory layout for backend, frontend, docs, specs.
- FastAPI backend skeleton with `/health` and `/health/db` endpoints.
- React + TypeScript + Vite frontend skeleton with app shell, placeholder routing, and an error boundary.
- PostgreSQL + Alembic with an empty baseline migration.
- Docker Compose for local development.
- `.env.example` and `.env` ignored.
- GitHub Actions CI: backend tests, frontend tests/typecheck/build, migration up/down check.
- Documented staging deployment path.

**Explicitly out of scope (deferred to later sprints, per [docs/current-sprint.md](../../docs/current-sprint.md)):**

Auth, RBAC, tenant_id columns, RLS, catalog, orders, payments, billing/Stripe, offline sync, refunds, shifts, inventory, reporting, Sentry beyond a placeholder, Tailwind/shadcn, Dexie, TanStack Query, i18n wiring, any vertical-specific feature.

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI, Python 3.12, SQLAlchemy 2, Pydantic v2, Alembic |
| Backend deps | `uv` + `pyproject.toml` |
| Backend tests | `pytest`, `httpx` |
| Backend lint | `ruff` |
| Frontend | React 18, TypeScript, Vite |
| Frontend tests | Vitest + `@testing-library/react` |
| Frontend lint | ESLint, `tsc --noEmit` for typecheck |
| Database | PostgreSQL 16 |
| Local orchestration | Docker Compose |
| CI | GitHub Actions |

## Repo Layout

```text
point_of_sale/
  CLAUDE.md
  README.md
  .env.example
  .gitignore
  docker-compose.yml
  docs/
    architecture.md
    current-sprint.md
    deferred-scope.md
    deployment.md
    risk-register.md
    sprint-planning.md
    adr/
  specs/
    README.md
    shared/
      project_skeleton.md
      local_dev.md
  backend/
    pyproject.toml
    Dockerfile
    .dockerignore
    alembic.ini
    alembic/
      env.py
      script.py.mako
      versions/
        0001_baseline.py
    app/
      __init__.py
      main.py
      config.py
      db.py
      health/
        __init__.py
        router.py
      tests/
        __init__.py
        conftest.py
        test_health.py
  frontend/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    Dockerfile
    .dockerignore
    .eslintrc.cjs
    src/
      main.tsx
      App.tsx
      ErrorBoundary.tsx
      routes/
        Home.tsx
      __tests__/
        App.test.tsx
  .github/
    workflows/
      ci.yml
```

## Module Boundaries

The architecture document ([docs/architecture.md](../../docs/architecture.md)) defines the eventual modular monolith with `auth/`, `tenants/`, `catalog/`, etc. Sprint 0A creates only a single domain folder (`health/`) as a proof that the per-domain layout (router/service/repository) works. All other domain modules are added in subsequent sprints when they have specs.

## Acceptance Criteria

- `docker compose up --build` boots all three services (`db`, `backend`, `frontend`) cleanly.
- `GET http://localhost:8000/health` returns `{"status":"ok"}`.
- `GET http://localhost:8000/health/db` returns 200 when DB is reachable.
- `http://localhost:5173` renders the placeholder app shell.
- `cd backend && uv run pytest` passes.
- `cd frontend && npm test -- --run && npm run typecheck && npm run build` passes.
- `alembic upgrade head` applies cleanly; `alembic downgrade base` reverses cleanly.
- GitHub Actions CI is green on PRs.
- `.env.example` exists; `.env` is ignored; no secrets committed.

## Non-Functional Requirements

- No domain models, no `tenant_id`, no auth: this sprint is structural only.
- All future migrations chain from the empty `0001_baseline` revision.
- The skeleton must not introduce any libraries that lock in product decisions deferred to later sprints (no Tailwind, Dexie, TanStack Query, etc.).

## Out of Scope of BDD

This is a structural sprint, not user-facing business behavior. Per [CLAUDE.md](../../CLAUDE.md) §Specification-Driven Development, BDD is required for P0/P1 user-facing behavior, not for skeleton scaffolding. Verification is via the smoke tests in this spec and [local_dev.md](local_dev.md).

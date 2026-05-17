# Kova

POS multi-tenant offline-first para PyMEs en México. Tu negocio, en flujo constante.

See [CLAUDE.md](CLAUDE.md) for the product, engineering, brand, and architectural rules of this repository.

## Status

Active sprint scope: [docs/current-sprint.md](docs/current-sprint.md). Kova rebrand is in progress; see CLAUDE.md for migration phases.

## Quickstart

```sh
cp .env.example .env
docker compose up --build
```

- Backend: http://localhost:8000/health
- Frontend: http://localhost:5173

Full local-dev instructions: [specs/shared/local_dev.md](specs/shared/local_dev.md).

## Documentation

- [CLAUDE.md](CLAUDE.md) — repository, product, and brand rules
- [docs/architecture.md](docs/architecture.md) — architecture overview
- [docs/sprint-planning.md](docs/sprint-planning.md) — sprint plan
- [docs/current-sprint.md](docs/current-sprint.md) — active sprint scope
- [docs/deployment.md](docs/deployment.md) — staging/production deployment path
- [specs/](specs/) — feature specifications

## Repo Layout

```text
backend/    FastAPI app, Alembic migrations, pytest
frontend/   Vite + React + TypeScript, Vitest
docs/       architecture, sprint planning, deployment, ADRs
specs/      feature specifications
```

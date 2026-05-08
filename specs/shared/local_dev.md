# Spec — Local Development (Sprint 0A)

## Required Tools

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | latest | Runs Postgres + backend + frontend locally |
| Docker Compose | v2 (bundled with Docker Desktop) | Service orchestration |
| Python | 3.12+ | Required if running backend outside Docker |
| `uv` | latest ([astral.sh/uv](https://astral.sh/uv)) | Python dependency manager |
| Node.js | 20 LTS | Required if running frontend outside Docker |
| npm | bundled with Node 20 | Frontend deps |
| Git | any recent | VCS |

## Database Choices for Local Development

Staging and production use **Supabase Postgres** (see [../../docs/deployment.md](../../docs/deployment.md)). For local development you can pick either:

| Mode | When to use | `DATABASE_URL` |
|---|---|---|
| **A. Local Docker Postgres** (default) | Fast, offline, no external account needed. Best for routine dev and tests. | `postgresql+psycopg://pos:pos@db:5432/pos` |
| **B. Supabase dev project** | When you need to validate behavior against the same engine, extensions, RLS, or pooler used in staging/production. | `postgresql+psycopg://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres` |

Switching modes is just an edit to `DATABASE_URL` in `.env` — the app does not care which Postgres is on the other end. Sprint 0A does not provision any Supabase resources automatically; if you choose mode B, create a personal Supabase dev project manually and copy its connection string from **Settings → Database** in the Supabase dashboard. Prefer the connection-pooler URL (port `6543`) if you expect many short-lived connections.

## First-Time Setup (Mode A — Local Docker Postgres)

```sh
git clone <repo>
cd point_of_sale
cp .env.example .env
docker compose up --build
```

Compose brings up:

- `db` — PostgreSQL 16 on localhost:5432 (local-only; never used for staging/prod)
- `backend` — FastAPI on http://localhost:8000 (runs `alembic upgrade head` on start)
- `frontend` — Vite dev server on http://localhost:5173

## First-Time Setup (Mode B — Supabase Dev Project)

```sh
git clone <repo>
cd point_of_sale
cp .env.example .env
# Edit .env: set DATABASE_URL to your Supabase project's connection string.
docker compose up --build backend frontend     # skip the local `db` service
```

Notes:

- The local `db` service is unused in Mode B. Bringing it up is harmless but wastes resources.
- The backend container runs `alembic upgrade head` on start, which will apply migrations to your Supabase dev database. Use a *dev* project — never run local code against staging/production.
- Supabase Auth and Supabase Storage are **not** wired up in Sprint 0A. Only the Postgres connection is used.

## Smoke Test

```sh
curl http://localhost:8000/health        # {"status":"ok"}
curl http://localhost:8000/health/db     # {"status":"ok","db":"reachable"}
open http://localhost:5173               # app shell renders
```

## Environment Variables

Defined in `.env.example`. Copy to `.env` for local use (`.env` is gitignored). No secrets are committed.

| Variable | Example | Purpose |
|---|---|---|
| `APP_ENV` | `local` | Switches config (`local`, `staging`, `production`) |
| `DATABASE_URL` | `postgresql+psycopg://pos:pos@db:5432/pos` (Mode A) or Supabase URL (Mode B) | SQLAlchemy DB URL. Either local Docker Postgres or a Supabase project's Postgres connection string. |
| `BACKEND_PORT` | `8000` | Host port for backend |
| `FRONTEND_PORT` | `5173` | Host port for frontend |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend URL the frontend calls |
| `POSTGRES_USER` | `pos` | Local Docker Postgres only (Mode A); ignored in Mode B |
| `POSTGRES_PASSWORD` | `pos` | Local Docker Postgres only (Mode A); never used in staging/production |
| `POSTGRES_DB` | `pos` | Local Docker Postgres only (Mode A) |

## Running Without Docker (optional)

### Backend

```sh
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

### Frontend

```sh
cd frontend
npm ci
npm run dev
```

You will need a Postgres reachable at `DATABASE_URL` (e.g., `docker compose up db`).

## Tests, Lint, Typecheck

### Backend

```sh
cd backend
uv run ruff check .
uv run pytest
```

### Frontend

```sh
cd frontend
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

## Migrations

```sh
cd backend
uv run alembic upgrade head        # apply
uv run alembic downgrade base      # revert all
uv run alembic revision -m "msg"   # new revision (later sprints)
```

The Sprint 0A baseline migration `0001_baseline` is intentionally empty. Domain tables land in subsequent sprints.

## Resetting Local State

**Mode A (local Docker Postgres):**

```sh
docker compose down -v             # drops the local Postgres volume
docker compose up --build
```

**Mode B (Supabase dev project):** the `down -v` above does not affect Supabase. To reset a Supabase dev DB, either run `alembic downgrade base` against it, or use the Supabase dashboard. Never reset staging or production this way.

## Troubleshooting

- **Backend can't reach DB on first start**: the backend service waits on the db healthcheck; on slow machines, retry `docker compose up`.
- **Port already in use**: change `BACKEND_PORT` / `FRONTEND_PORT` in `.env`.
- **`alembic` command not found**: run inside `uv run alembic …` or activate the uv venv.

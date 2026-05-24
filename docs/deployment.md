# Deployment

Sprint 0A delivers only the *documented* deployment path. No staging or production infrastructure is provisioned this sprint, and no Supabase resources are created automatically.

## Database Provider: Supabase

This project uses **Supabase Postgres** as the hosted database for staging and production. The application connects to Supabase as a plain PostgreSQL database via `DATABASE_URL` — there is no Supabase-specific code path. Local Docker Postgres (in [../docker-compose.yml](../docker-compose.yml)) is for **local development and tests only** and is never used as the staging or production database.

Supabase features that are **not** in scope for Sprint 0A:

- Supabase Auth (a future auth sprint will decide whether to use it or build on top of it)
- Supabase Storage
- Supabase Edge Functions
- Supabase Realtime
- `supabase/` CLI-managed migrations — we use Alembic against Supabase's Postgres instead, so migration history lives in our repo.

For Sprint 0A, Supabase is treated strictly as managed Postgres.

## Target Topology (Beta)

```text
GitHub Actions  ──build──►  container registry / static host
                                │
                                ├──► Backend host  (FastAPI in Docker)
                                │       │
                                │       └──► Supabase Postgres (managed)
                                │
                                └──► Frontend host (static build of Vite output)
```

## Recommended Hosting (Beta)

| Component | Choice | Notes |
|---|---|---|
| Database | **Supabase Postgres** | One project per environment (e.g. `pos-staging`, `pos-prod`). |
| Backend | Fly.io (Docker, region near Mexico) | Render or Railway are acceptable alternatives. |
| Frontend | Vercel | Netlify or Cloudflare Pages are acceptable alternatives. |
| Secrets | Hosting-provider secret store + Supabase dashboard | No secrets in repo, ever. |

We are **not** using Terraform in Sprint 0A. Provisioning is documented and manual.

## Supabase Setup (One-Time, Manual, per Environment)

Performed by a human operator outside Sprint 0A:

1. Create a Supabase project (`pos-staging`, then later `pos-prod`).
2. In **Settings → Database**, copy the connection string. Two are exposed:
   - **Direct** (`db.<PROJECT-REF>.supabase.co:5432`) — best for long-running backend processes and migrations.
   - **Pooler** (`<region>.pooler.supabase.com:6543`) — best for serverless/short-lived connections.
3. Store the connection string in the backend hosting provider's secret store as `DATABASE_URL`. Use `postgresql+psycopg://...` so SQLAlchemy picks the `psycopg` driver.
4. Confirm the database is reachable from CI/the backend host's region.
5. Run `alembic upgrade head` once against the new project (see *Deploy Procedure*).

Repeat for production with a separate Supabase project. Never share a single Supabase project across environments.

## Connection String Format

```text
postgresql+psycopg://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres
```

For pooled connections:

```text
postgresql+psycopg://postgres.<PROJECT-REF>:<PASSWORD>@<region>.pooler.supabase.com:6543/postgres
```

Pick one consistently per environment. Pooler URLs are typically the right default for hosted backends.

## Environment Variables (Staging / Production)

Mirror [.env.example](../.env.example), but supply real values via the hosting provider's secret manager. Required for the backend:

- `APP_ENV` — `staging` or `production`
- `DATABASE_URL` — the Supabase connection string for that environment

Local-only `POSTGRES_*` variables and the `db` Docker service are **not** used in staging/production.

The frontend build needs:

- `VITE_API_BASE_URL` — public URL of the backend

Future sprints will add: session secrets, `SENTRY_DSN`, `STRIPE_*`, and (if/when adopted) `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Deploy Procedure (Manual, Beta)

1. Tag a release: `git tag vX.Y.Z && git push --tags`.
2. CI builds the backend image and a frontend bundle.
3. Deploy backend image to Fly.io (`fly deploy`) with `DATABASE_URL` pointing at the target Supabase project. The `release_command` in `backend/fly.toml` runs `alembic upgrade head` against `DATABASE_URL` automatically before the new version is promoted; if the migration fails the deploy is aborted and the previous version keeps serving traffic. For long-running backfills, skip the auto-migration by deploying with `flyctl deploy --no-release-command` and run the migration manually via `fly ssh console`.
4. Deploy frontend bundle to Vercel (auto-deploys from `main` once configured).
5. Verify:
   - `curl https://api.<domain>/health`
   - `curl https://api.<domain>/health/db` — proves the backend can reach Supabase.
   - Browse the frontend domain.

## Rollback

- **Backend:** `fly releases` → `fly deploy --image <previous-tag>`.
- **Database (Supabase):** every migration in `backend/alembic/versions/` must implement `downgrade()`. CI's `migrations` job verifies up→down→up reversibility on every PR. To roll a migration back in staging: `alembic downgrade -1` against the staging `DATABASE_URL`. Do **not** roll back destructive migrations in production without a tested data-preservation plan. Supabase also provides point-in-time recovery on paid plans — confirm the plan/retention before relying on it.
- **Frontend:** Vercel "Promote previous deployment" button.

## Backups

Supabase manages physical backups for the project. Before beta, document and execute a **restore drill**:

1. Trigger a snapshot/PITR restore into a fresh Supabase project.
2. Point a throwaway backend instance at the restored DB.
3. Confirm `/health/db` and a representative read query work.

This is a hard gate for beta (per [../CLAUDE.md](../CLAUDE.md) §Hard Gates) and not Sprint 0A scope.

## Production Data Hygiene Scripts

Kova Audit Sprint 6 requires these one-off, idempotent scripts to be run against production before
live paid beta expansion:

```powershell
$env:DATABASE_URL="<production-postgres-url>"
uv run python backend/scripts/clamp_negative_stock.py --dry-run
uv run python backend/scripts/fix_category_accents.py --dry-run
uv run python backend/scripts/backfill_skus.py --dry-run
```

If the dry-run output is expected, run the apply commands:

```powershell
$env:DATABASE_URL="<production-postgres-url>"
uv run python backend/scripts/clamp_negative_stock.py
uv run python backend/scripts/fix_category_accents.py
uv run python backend/scripts/backfill_skus.py
```

Record the production run here after execution:

| Date | Operator | Script | Dry-run result | Apply result | Rollback / recovery note |
|---|---|---|---|---|---|
| 2026-05-24 | Codex via Fly SSH | `clamp_negative_stock.py` | 2 products for tenant `549477db-0192-49d0-a041-861b750c4215`: `Agua mineral`, `Galleta New York` at `-1`. | Blocked: production image used invalid `movement_type='stock_adjustment'`; script fixed in repo to use `adjustment`, but production image must be updated before apply. | Inserts compensating `adjustment` rows; recover by inserting inverse adjustment if needed. |
| 2026-05-24 | Codex via Fly SSH | `fix_category_accents.py` | 2 rows: `Cafe caliente -> Café caliente`, `Bebidas frias -> Bebidas frías`. | Applied: updated 2 rows. Follow-up dry-run: no rows matched. | Updates exact known category names only; recover by renaming rows back if needed. |
| 2026-05-24 | Codex via Fly SSH | `backfill_skus.py` | 3 SKUs for tenant `549477db-0192-49d0-a041-861b750c4215`. | Applied: assigned 3 SKUs. Follow-up dry-run: no products needed a SKU. | Assigns missing SKUs only; recover by clearing affected generated SKUs if needed. |

## Pre-Beta Hard Gates (Running Checklist)

These must be addressed before exposing real tenants — not Sprint 0A work:

- Tenant isolation tests passing
- Auth/session tests passing
- Backup restore drill executed (see *Backups* above)
- No critical/high dependency vulnerabilities
- Sentry / structured logs configured
- Uptime monitor configured
- RLS policies authored and tested on Supabase

## Out of Scope of Sprint 0A

- Provisioning Supabase projects (manual, one-time, performed by an operator)
- Supabase Auth, Storage, Edge Functions, Realtime
- Terraform or any IaC
- TLS certificates, custom domains, CDN configuration
- Sentry/observability stack setup beyond placeholder configuration

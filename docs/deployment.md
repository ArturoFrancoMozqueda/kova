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
3. Store the **owner** connection string (the Supabase `postgres` role) in the backend hosting provider's secret store as `MIGRATION_DATABASE_URL`. Use `postgresql+psycopg://...` so SQLAlchemy picks the `psycopg` driver. This role runs migrations (DDL) and the small set of RLS-bypass paths.
4. Confirm the database is reachable from CI/the backend host's region.
5. Run `alembic upgrade head` once against the new project (see *Deploy Procedure*).
6. **Provision the least-privilege app role (`kova_app`).** After the first migration, run [../backend/scripts/provision_app_role.sql](../backend/scripts/provision_app_role.sql) once as the owner, injecting a strong password via env — never commit it:

   ```bash
   psql "$MIGRATION_DATABASE_URL" \
     -v kova_app_password="$KOVA_APP_DB_PASSWORD" \
     -f backend/scripts/provision_app_role.sql
   ```

   Then set `APP_DATABASE_URL` in the secret store to the same connection string but with the `kova_app` user + `KOVA_APP_DB_PASSWORD`. The application connects as `kova_app` at runtime so RLS `tenant_isolation` policies are enforced (the `postgres` owner bypasses RLS and must not be the runtime role). See [ADR-009](adr/ADR-009-backend-only-rls-no-policy-tables.md) and `PLAN-02`.

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
- `APP_DATABASE_URL` — runtime connection as the least-privilege `kova_app` role (subject to RLS). This is what the app serves requests with.
- `MIGRATION_DATABASE_URL` — owner (`postgres`) connection for Alembic migrations and RLS-bypass paths (webhook, public assets, pre-session auth).

- `DATABASE_URL` — legacy single URL. Still honored as the fallback for both of the above when they are unset (keeps local dev working), but staging/production should set the two explicit URLs so the runtime role is `kova_app`.

Local-only `POSTGRES_*` variables and the `db` Docker service are **not** used in staging/production.

Production startup requires `APP_DATABASE_URL` to be explicit and different
from `MIGRATION_DATABASE_URL`. It queries Postgres catalogs and aborts if the
runtime role is a superuser, has `BYPASSRLS`, owns a tenant table, or any
canonical tenant table lacks RLS, `FORCE ROW LEVEL SECURITY`, `USING`, or
`WITH CHECK`. Local/CI retain diagnostic logging so migrations can bootstrap.

### Updating pinned container build inputs

`backend/Dockerfile` pins both the Python base and `uv` images by release and
multi-platform digest. Inspect updates with `docker buildx imagetools inspect`,
review the upstream releases, then change each tag and digest together in one
commit. CI builds the backend twice without layer reuse, requires identical
Docker image configs and loadable archives, and generates an SPDX JSON SBOM
from the reproduced image. The build uses `SOURCE_DATE_EPOCH=0`, BuildKit's
`rewrite-timestamp=true`, disables nondeterministic inline provenance for this
comparison, and runs `uv sync --no-cache` so temporary cache paths never enter
the image layer. Both archives carry the same explicit image tag; CI loads the
first verified archive before scanning it. The SBOM remains a separate
commit-addressed artifact. All checks run before any migration or deploy job.

The frontend uses same-origin relative API paths (`/api/v1/...`). Production routing is handled by
`frontend/vercel.json`, which rewrites those paths to the Fly backend. No `VITE_API_BASE_URL` is
required for current API calls.

Future sprints will add: session secrets, `SENTRY_DSN`, `STRIPE_*`, and (if/when adopted) `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Deploy Procedure (Manual, Beta)

For pushes to `main`, `.github/workflows/ci.yml` is now the release source of truth. The manual
steps below are recovery/reference steps only; do not run them in parallel with CI.

### Automated release gate

The release graph is: named checks (`integration`, `e2e-mocked`, dependency/secret checks) â†’
migration reversibility â†’ Fly deploy plus an unpromoted Vercel production candidate â†’ exact-commit
health/read-only verification â†’ promotion of the already-tested Vercel artifact â†’ final alias
verification. Fly receives `KOVA_RELEASE_SHA` at image build time and
`/health` exposes it; Vercel's `version.json` exposes the first 12 characters of the same SHA.

Configure a protected GitHub `production` environment with required reviewers and these secrets:

- `FLY_API_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_URL`.
- `VERCEL_AUTOMATION_BYPASS_SECRET` for read-only verification of the protected staged candidate.

Authenticated production QA uses an explicitly authorized human account and the manual checklist;
credentials are never stored in GitHub Actions and CI does not create tenants, sales, or sessions. The
`VERCEL_TOKEN` must be renewed no later than **2027-08-14**; never record its value in this document.

`frontend/vercel.json` sets `git.deploymentEnabled` to `false`, so connected Git cannot race the
tested candidate or its CI-controlled promotion. Keep credentials only in the protected environment. A failed
post-deploy gate prevents Vercel promotion and restores Fly's exact pre-deploy image when it was
captured successfully. If image capture is empty, stop and use `fly releases` plus
`fly deploy --image <previous-image>`; never guess an image or roll back a destructive migration.

If a manual sale is explicitly authorized, use a unique traceable reference. Do not delete or void
the ledger entry automatically because that would create misleading accounting history.

1. Tag a release: `git tag vX.Y.Z && git push --tags`.
2. CI builds the backend image and a frontend bundle.
3. Deploy backend image to Fly.io (`fly deploy`) with `DATABASE_URL` pointing at the target Supabase project. The `release_command` in `backend/fly.toml` runs `alembic upgrade head` against `DATABASE_URL` automatically before the new version is promoted; if the migration fails the deploy is aborted and the previous version keeps serving traffic. For long-running backfills, skip the auto-migration by deploying with `flyctl deploy --no-release-command` and run the migration manually via `fly ssh console`.
4. Deploy the frontend candidate from the CI workflow; connected Git deployments are disabled.
5. Verify:
   - `curl https://api.<domain>/health`
   - `curl https://api.<domain>/health/db` — proves the backend can reach Supabase.
   - Browse the frontend domain.

## Rollback

- **Backend:** `fly releases` → `fly deploy --image <previous-tag>`.
- **Database (Supabase):** every migration in `backend/alembic/versions/` must implement `downgrade()`. CI's `migrations` job verifies up→down→up reversibility on every PR. To roll a migration back in staging: `alembic downgrade -1` against the staging `DATABASE_URL`. Do **not** roll back destructive migrations in production without a tested data-preservation plan. Supabase also provides point-in-time recovery on paid plans — confirm the plan/retention before relying on it.
- **Frontend:** Vercel "Promote previous deployment" button.

## Backups

Supabase manages provider-side physical backups, but Kova also keeps an application-owned logical
backup in Cloudflare R2.

Current workflow:

- Workflow: `.github/workflows/db-backup.yml`
- Trigger: daily at 09:00 UTC and manual `workflow_dispatch`
- Source: `SUPABASE_DB_URL` GitHub Actions secret
- Dump client: PostgreSQL 17 `pg_dump`
- Format: PostgreSQL custom dump (`--format=custom --compress=9`)
- Destination: Cloudflare R2 bucket from `R2_BUCKET_NAME`
- Prefix: `supabase/postgres/`
- Retention: 7 days

Required GitHub Actions secrets:

- `SUPABASE_DB_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_BUCKET_NAME`

`SUPABASE_DB_URL` for backup must be compatible with `pg_dump`. Prefer the Supabase session pooler
on port 5432 or direct connection; do not use the transaction pooler on port 6543.

Before broader paid beta, document and execute a **restore drill**:

1. Download the latest R2 dump.
2. Restore it into a fresh Supabase project.
3. Point a throwaway backend instance at the restored DB.
4. Confirm `/health/db` and representative read queries work.

Use `docs/runbooks/restore-supabase-backup.md` for the detailed procedure. This remains a hard gate.

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
| 2026-05-24 | Codex via Fly SSH | `clamp_negative_stock.py` | Initial dry-run found 2 products for tenant `549477db-0192-49d0-a041-861b750c4215`: `Agua mineral`, `Galleta New York` at `-1`. Post-deploy dry-run of corrected script returned no negative stock. | No apply needed after post-deploy verification; database already had no negative stock remaining. | Inserts compensating `adjustment` rows when needed; recover by inserting inverse adjustment if needed. |
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
- ✅ RLS policies authored, **forced**, and enforced at runtime (PLAN-02): the app connects as the non-owner `kova_app` role, every tenant-scoped table has `FORCE ROW LEVEL SECURITY` + `WITH CHECK`, and `app/tests/test_rls_enforcement.py` proves cross-tenant reads/writes are blocked at the SQL layer. Remaining ops step per environment: run `provision_app_role.sql` on Supabase and set `APP_DATABASE_URL`/`MIGRATION_DATABASE_URL`.

## Out of Scope of Sprint 0A

- Provisioning Supabase projects (manual, one-time, performed by an operator)
- Supabase Auth, Storage, Edge Functions, Realtime
- Terraform or any IaC
- TLS certificates, custom domains, CDN configuration
- Sentry/observability stack setup beyond placeholder configuration

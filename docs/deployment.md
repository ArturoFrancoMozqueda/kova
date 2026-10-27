# Deployment

Operational references updated 2026-10-26. The current deployment uses Cloudflare Workers Static
Assets for the frontend and a resident FastAPI Container behind Cloudflare for the API. Vercel
remains the protected release candidate/fallback. Fly was retired on 2026-10-19 and is not a
deployment or recovery provider. The original Sprint 0A notes below describe historical scope,
not a statement that production is unprovisioned.

Authoritative implementation: [frontend](../deploy/cloudflare/README.md),
[resident backend](../deploy/cloudflare-native/README.md), [CI release](../.github/workflows/ci.yml),
[release/recovery scripts](../frontend/scripts/release.mjs) and [current acceptance](current-sprint.md).

## Database Provider: Supabase

This project uses **Supabase Postgres** as the hosted database for staging and production. The
application connects as PostgreSQL with separate `APP_DATABASE_URL` and `MIGRATION_DATABASE_URL`;
`DATABASE_URL` is the legacy/local fallback described below. Local Docker Postgres (in
[../docker-compose.yml](../docker-compose.yml)) is for **local development and tests only**.

Supabase features that are **not** in scope for Sprint 0A:

- Supabase Auth (Kova's current authentication uses its own FastAPI/Postgres sessions and cookies)
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

## Current Hosting

| Component | Choice | Notes |
|---|---|---|
| Database | **Supabase Postgres** | One project per environment (e.g. `pos-staging`, `pos-prod`). |
| Backend | Cloudflare resident FastAPI Container and gateway | Existing runtime roles, bindings and exact-version recovery; no Fly fallback. |
| Frontend | Cloudflare Workers Static Assets | Vercel is the protected release candidate/fallback; use the integrated release workflow. |
| Secrets | Hosting-provider secret store + Supabase dashboard | No secrets in repo, ever. |

The original Sprint 0A did not provision resources. New infrastructure or database provisioning
still requires a separately reviewed operator procedure; do not rerun one-time native provisioning.

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

These are format examples, not an instruction to rotate active connections or switch ports.
Use the target's verified native/Workers configuration, keep runtime and owner credentials separate,
and use the session/direct connection required by the restore/backup runbooks for those tools.

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
commit. The supply-chain gate builds the backend twice without layer reuse,
requires identical Docker image configs and loadable archives, and generates an
SPDX JSON SBOM. It runs when Dockerfiles, lockfiles, build infrastructure or CI
change, plus weekly and manually through `CI maintenance`. It blocks release
when applicable. Ordinary product changes retain real-stack container startup
validation without repeating the reproducibility exercise. The comparison uses
`SOURCE_DATE_EPOCH=0`, `rewrite-timestamp=true` and separate commit-addressed SBOM
artifacts; release acceptance separately verifies the actual published Container's identity.

The frontend uses same-origin relative API paths (`/api/v1/...`). The public Cloudflare frontend
Worker proxies them to the Cloudflare API; `frontend/vercel.json` preserves the protected candidate
path. Neither forwards database credentials to the browser. No `VITE_API_BASE_URL` is required.

Session, Sentry and Stripe configuration belongs to the existing backend/provider secret stores.
The current runtime does not use Supabase Auth or expose Supabase database credentials in Vite.

## Current Release Procedure

For pushes to `main`, `.github/workflows/ci.yml` is now the release source of truth. The manual
historical Fly steps below are retired, not an alternative manual production path. Do not race CI.

### Automated release gate

All applicable validations run in parallel and feed the single **CI required**
result. Frontend validation builds once and runs mocked Playwright against that
production preview; Vite dev remains a local tool. Migration reversibility no
longer waits for other suites. Documentation-only changes skip application suites
and publication, while repository, dependency and secret checks still run.
See [testing-ci.md](testing-ci.md) for the test inventory, removal rationale and measurements.

After **CI required** passes on `main`, one protected release job captures and
uploads the exact rollback artifact, builds and stages Vercel with production
configuration, runs migrations with the separate owner connection, publishes the Cloudflare
backend, verifies the candidate, promotes its same static artifact to Cloudflare, and verifies
the public site/API/database. `frontend/scripts/release.mjs` sets its recovery
phase before a provider can change production and calls the existing recovery
implementation on failure. A failed candidate build/upload leaves production alone.
The resident image carries `KOVA_RELEASE_SHA` and must match the controller's `KOVA_BUILD_SHA`;
`/health` exposes the full SHA and frontend `version.json` its first 12 characters. Verification checks public HTML,
direct backend/database and same-origin API proxy paths. Each request has a
20-second timeout so unreachable endpoints enter recovery instead of hanging.

The branch API reported `main` unprotected and no repository rulesets on
2026-10-07. Configure `CI required` as the required status check for merging;
the workflow already gates publication on that result. This change does not
alter GitHub branch or environment settings.

Configure a protected GitHub `production` environment with required reviewers and these secrets:

- Existing Cloudflare deployment credentials and native runtime/migration bindings per the
  [resident backend](../deploy/cloudflare-native/README.md). The workflow uses
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the separate migration-only `SUPABASE_DB_URL`.
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` for the captured candidate/fallback.
- `VERCEL_AUTOMATION_BYPASS_SECRET` for read-only verification of the protected staged candidate.

Authenticated production QA uses an explicitly authorized human account and the manual checklist;
credentials are never stored in GitHub Actions and CI does not create tenants, sales, or sessions. The
`VERCEL_TOKEN` must be renewed no later than **2027-08-14**; never record its value in this document.

`frontend/vercel.json` sets `git.deploymentEnabled` to `false`, so connected Git cannot race the
tested candidate or its CI-controlled promotion. The Vercel project also keeps
`autoAssignCustomDomains` disabled; the capture gate verifies that setting before every release, and
candidate deployment uses `--skip-domain` until the explicit promotion step. Keep credentials only
in the protected environment.
Before any deployment, CI persists `release-rollback-<sha>` with the exact prior Cloudflare frontend
and backend Worker versions, native Container snapshot, immutable Vercel deployment URL and
coherent release SHA. Empty or inconsistent capture fails before a
candidate is created.

Recovery is selected by the last phase reached:

- **candidate:** frontend promotion has not begun; restore the captured backend Worker/Container state;
- **promotion / acceptance:** first restore the captured Cloudflare frontend version and Vercel
  deployment, then the backend Worker/Container state, as implemented in
  [release-recovery.mjs](../frontend/scripts/release-recovery.mjs).

`frontend/scripts/release-recovery.mjs` validates the complete artifact before the first provider
command and verifies the restored site, direct backend, database and frontend API proxy against the
prior SHA. `RECOVERY_BLOCKED` is an explicit incident: stop the release, keep the serialized release
queue blocked and inspect the provider state. Never guess an image/deployment or automatically
downgrade the database; production migrations must remain backward compatible with the captured
application artifacts.

If a manual sale is explicitly authorized, use a unique traceable reference. Do not delete or void
the ledger entry automatically because that would create misleading accounting history.

### Retired manual Fly procedure (historical)

The former tag → Fly deploy/release-command → Vercel sequence is retired. Its exact commands and
configuration remain in git history; they must not be used to deploy, wake or recover production.
Use the current integrated CI release and captured rollback procedure above. Browser acceptance
is documented separately in the [production smoke contract](../specs/ops/production_smoke.md);
its default mode does not create financial records or validate Stripe live Checkout.

## Rollback

### Interrupted release on 2026-10-22

Historical incident record, closed by the public verification recorded below. Its hard-coded
recovery workflow is scoped to that captured incident and is not a general command to run today.

Run `39709835800` stopped after publishing backend `443fa3fc84bf` and before
frontend promotion. Its exact `release-rollback-443fa3fc84bf24b9bddb35c449c3fe1ec918b1ca`
artifact captures the prior coherent release `b8b00c36b9697b9ae1009bd8cad57894d31a340a`.
The manual `recover-interrupted-release.yml` workflow restores that backend using
the existing candidate-phase recovery, then verifies the public site, direct
backend/database and frontend API proxy. It never downgrades the database.

After explicit operator approval, merge the recovery workflow and dispatch it
from `main` with `approve_recovery=true`. It shares the normal release concurrency
queue, uses the `production` environment, checks the exact downloaded artifact's
SHA-256 and rejects a changed incident state before provider mutations. A failed
or expired artifact check blocks recovery; never replace the snapshot with guessed
versions. Retrying after partial recovery requires inspecting provider state.
Only after successful recovery, rerun the latest `main` CI workflow to publish
the tested UX changes. Confirm `/health` and `/version.json` match that run's SHA.
On 2026-10-21 (Mexico City), the environment API reported no protection rules;
the workflow's explicit approval input does not replace required reviewers.

Recovery run `39809193983` restored the captured Worker versions and started the
exact captured Container image rollout, but its five-minute readiness budget
expired before the image converged. Cloudflare's [replacement sequence](https://developers.cloudflare.com/containers/configuration/rollouts/#how-a-container-instance-is-replaced)
allows up to 15 minutes to drain an old process. Native publication and recovery
therefore allow 30 minutes for strict image/runtime/process readiness, covering
both draining and provider propagation: this recovery took about 25 minutes
before public convergence. Standalone cold provisioning keeps its five-minute
budget. The release job allows 90 minutes for tooling, publication and recovery;
the incident recovery job allows 35.
Foreign SHAs, application errors and failed database/proxy checks still block.
Inspect the active rollout before retrying a `RECOVERY_BLOCKED` run. A completed
provider rollout must pass the full deployment verifier before normal CI resumes.
On 2026-10-22 at 16:19 UTC, public verification confirmed the original captured
release `b8b00c36b969` on frontend, backend, database and proxy. Resident acceptance
passed 25 contracts with one process (median 251 ms, maximum 768 ms). The provider
reported the restored application image before the running process converged;
provider completion therefore never substitutes for public acceptance. The
existing rolling strategy and exact captured artifact remain unchanged.

- **Coordinated release:** use the `release-rollback-<sha>` artifact from the failed workflow and the
  phase-aware recovery job. A missing artifact is a blocking incident, not permission to infer a
  target from “latest”.
- **Backend:** restore the exact captured Cloudflare backend versions and native Container
  snapshot through phase-aware recovery; the retired Fly commands are not a fallback.
- **Database (Supabase):** every migration in `backend/alembic/versions/` must implement `downgrade()`. CI's `migrations` job verifies up→down→up reversibility on every PR. To roll a migration back in staging: `alembic downgrade -1` against the staging `DATABASE_URL`. Do **not** roll back destructive migrations in production without a tested data-preservation plan. Supabase also provides point-in-time recovery on paid plans — confirm the plan/retention before relying on it.
- **Frontend:** restore the captured Cloudflare version and Vercel deployment together when the
  recovery phase requires it; do not select an unverified build by age or change DNS ad hoc.

Repository fake-provider tests do not establish current provider permissions or artifact retention.
The dated incident above records actual Cloudflare recovery; each later release must still capture
its own exact state and pass public acceptance. Missing/expired artifacts remain a blocking incident.

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

Use the [restore runbook](runbooks/restore-supabase-backup.md) for the detailed procedure and the
[2026-10-10 evidence](audits/KOVA-R2-REAL-RESTORE-2026-10-10.md) for the completed logical R2 restore.
That evidence does not close fresh-host/provider-resource recovery, traffic switching or full
service RTO. Those remaining operational checks must keep their exact scope in the paid-beta gate.

## Production Data Hygiene Scripts

The one-off Audit Sprint 6 hygiene scripts (`clamp_negative_stock.py`, `fix_category_accents.py`,
`backfill_skus.py`) were applied to production on 2026-05-24 and retired from the tree on
2026-10-22. Their source and run log remain in git history.

## Pre-Beta Hard Gates (Running Checklist)

Use the [current release checklist](claude/release-ga-checklist.md) and
[operational gate](runbooks/ops-beta-gate.md) for dated evidence. The original pre-beta checks below
remain requirements, not claims that the latest commit has been accepted in production:

- Tenant isolation tests passing
- Auth/session tests passing
- Backup restore drill executed (see *Backups* above)
- No critical/high dependency vulnerabilities
- Sentry / structured logs configured
- Uptime monitor configured
- ✅ RLS policies authored, **forced**, and enforced at runtime (PLAN-02): the app connects as the non-owner `kova_app` role, every tenant-scoped table has `FORCE ROW LEVEL SECURITY` + `WITH CHECK`, and `app/tests/test_rls_enforcement.py` proves cross-tenant reads/writes are blocked at the SQL layer. Remaining ops step per environment: run `provision_app_role.sql` on Supabase and set `APP_DATABASE_URL`/`MIGRATION_DATABASE_URL`.

## Historical Scope of Sprint 0A

This section records the original planning boundary; it does not describe current hosting,
observability or production-readiness status.

- Provisioning Supabase projects (manual, one-time, performed by an operator)
- Supabase Auth, Storage, Edge Functions, Realtime
- Terraform or any IaC
- TLS certificates, custom domains, CDN configuration
- Sentry/observability stack setup beyond placeholder configuration

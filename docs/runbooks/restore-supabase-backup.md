# Runbook: Restore Supabase backup from Cloudflare R2

This runbook covers restoring the latest Supabase backup produced by the `Supabase database backup` GitHub Actions workflow (`.github/workflows/db-backup.yml`) into a **new** Supabase project for verification or disaster recovery.

> **Never restore on top of the production database.** Always restore into a fresh project (or a separate staging project) and validate before switching traffic.

---

## When to use this

- Quarterly **backup restore drill** (hard gate before Stripe live, per [../deployment.md](../deployment.md) §Backups).
- Data corruption or accidental destructive query in production.
- Cloning production into a debugging environment.

---

## Prerequisites

- Cloudflare R2 bucket `kova-db-backups` reachable with API credentials.
- A Supabase account that can create a new project.
- Locally installed:
  - PostgreSQL 17 client (`pg_restore`, `psql`) — must match the Supabase server major version (currently 17). Older clients refuse to run.
  - AWS CLI v2 configured with R2 credentials (or use a one-shot env-var form, below).

---

## Backup layout in R2

```
kova-db-backups/
└── supabase/
    └── postgres/
        ├── kova-2026-05-24T03-00-12Z.dump
        ├── kova-2026-05-24T09-00-08Z.dump
        └── …
```

- Format: PostgreSQL **custom** (`pg_dump --format=custom --compress=9`).
- Retention: 7 days (older files are pruned automatically by the workflow).
- Cadence: daily at 09:00 UTC plus on-demand via **Actions → Supabase database backup → Run workflow**.

---

## Step 1 — Identify the backup to restore

Set R2 credentials in your shell (PowerShell example):

```powershell
$env:AWS_ACCESS_KEY_ID     = "<R2_ACCESS_KEY_ID>"
$env:AWS_SECRET_ACCESS_KEY = "<R2_SECRET_ACCESS_KEY>"
$env:AWS_DEFAULT_REGION    = "auto"
$env:R2_ENDPOINT           = "https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com"
$env:R2_BUCKET             = "kova-db-backups"
```

List available backups (newest at the bottom):

```powershell
aws s3 ls "s3://$env:R2_BUCKET/supabase/postgres/" --endpoint-url $env:R2_ENDPOINT
```

Pick the most recent dump (or the one closest to the timestamp you need to recover to). Note the filename — for example `kova-2026-05-24T09-00-08Z.dump`.

---

## Step 2 — Download the dump

```powershell
$BACKUP = "kova-2026-05-24T09-00-08Z.dump"
aws s3 cp "s3://$env:R2_BUCKET/supabase/postgres/$BACKUP" "./$BACKUP" --endpoint-url $env:R2_ENDPOINT
```

Verify file size matches what the workflow reported (visible in the workflow run summary).

---

## Step 3 — Create a fresh Supabase project

1. Supabase dashboard → **New project** → name it `kova-restore-<YYYYMMDD>`.
2. Use the same region as production (currently `us-west-1`) to keep latency similar.
3. Choose Free tier — the drill does not need Pro.
4. Wait until the project is fully provisioned (status “Healthy”).
5. **Settings → Database → Connection string** → copy the **session pooler (port 5432)** URL and the password (only shown once).

Compose the target URL (PowerShell):

```powershell
$RESTORE_URL = "postgresql://postgres.<NEW-PROJECT-REF>:<NEW-PASSWORD>@<region>.pooler.supabase.com:5432/postgres?sslmode=require"
```

> Use port **5432 (session)**, not 6543 (transaction). `pg_restore` opens long-running transactions and the transaction pooler rejects them.

---

## Step 4 — Restore the dump

```powershell
pg_restore `
  --no-owner `
  --no-acl `
  --clean `
  --if-exists `
  --exit-on-error `
  --jobs=2 `
  --verbose `
  --dbname="$RESTORE_URL" `
  ".\$BACKUP" 2>&1 | Tee-Object -FilePath restore.log
```

Common flags explained:

| Flag | Why |
|---|---|
| `--no-owner` `--no-acl` | The dump references `postgres` ownership and Supabase roles that do not exist by name on a fresh project. Skipping them lets Supabase apply its own ownership defaults. |
| `--clean --if-exists` | Drops existing objects before recreating them, so the restore is idempotent across retries. |
| `--exit-on-error` | Fail fast on the first error instead of producing a partial database. |
| `--jobs=2` | Parallel restore (custom format only). 2 is a safe default for the Free tier; raise on Pro. |

Expect harmless warnings about missing extensions (e.g., `pg_graphql`, `vault`) — Supabase pre-installs them. Real errors will halt the restore because of `--exit-on-error`.

---

## Step 5 — Validate the restore

Smoke checks (replace `$RESTORE_URL`):

```powershell
psql "$RESTORE_URL" -c "select now(), current_database(), current_user;"
psql "$RESTORE_URL" -c "select count(*) as tenants from tenants;"
psql "$RESTORE_URL" -c "select count(*) as orders from orders;"
psql "$RESTORE_URL" -c "select max(created_at) as latest_order from orders;"
```

Cross-check the `latest_order` timestamp against the backup filename. For an active tenant, it
should be reasonably close to the daily backup window unless there were no recent orders.

Optional but recommended:

1. Deploy a throwaway backend instance (locally or on a Fly preview app) pointing at `$RESTORE_URL`.
2. Hit `GET /health/db` and confirm it returns 200.
3. Run a representative read query through the API (e.g., dashboard KPI endpoint).

---

## Step 6 — Decide what to do with the restored project

- **Drill (no incident)**: document the run in [../deployment.md](../deployment.md) under the backup table, then **delete the Supabase project** to avoid leaking PII into a long-lived clone.
- **Recovery (real incident)**: do **not** point production traffic at the restored project until you have reconciled with the team and (a) re-pointed `DATABASE_URL` in Fly secrets, or (b) used Supabase's project migration flow. Coordinate explicitly — restoring is the easy part, swapping in is the risky part.

---

## Failure modes and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `pg_restore: error: could not connect: FATAL: Tenant or user not found` | Wrong username in `$RESTORE_URL` — must be `postgres.<project-ref>`. | Re-copy from dashboard. |
| `pg_restore: error: could not connect: prepared statement … does not exist` | Connected to the transaction pooler (port 6543). | Use session pooler (port 5432). |
| `pg_dump: error: aborting because of server version mismatch` / `pg_restore: error: unsupported version` | Client major version is older than the Supabase server (currently 17). | Install PostgreSQL 17 client. If Supabase upgrades again, bump `postgresql-client-XX` in the workflow too. |
| Many `WARNING: extension "<name>" is not available` lines | Supabase manages its own extensions; the dump's `CREATE EXTENSION` statements may reference ones not present yet. | Harmless. The `--no-owner --no-acl` already mitigates most of these. |
| Restore finishes but `select count(*) from orders` returns 0 | Restored into the wrong database or the dump was empty (e.g., produced against an empty staging DB). | Check the workflow run that produced the backup and confirm size > a few KB. |

---

## Workflow operations cheat sheet

| Action | Where |
|---|---|
| Trigger a backup on demand | GitHub → Actions → **Supabase database backup** → Run workflow |
| Check last run status | Same page, Recent runs |
| Rotate `SUPABASE_DB_URL` after a Supabase password reset | GitHub → Settings → Secrets and variables → Actions → `SUPABASE_DB_URL` → Update |
| Adjust retention (currently 7 days) | Edit `RETENTION_DAYS` in `.github/workflows/db-backup.yml` |
| Inspect R2 storage usage | Cloudflare dashboard → R2 → `kova-db-backups` → Metrics |

---

## Drill log

Record every drill execution here:

| Date (UTC) | Operator | Backup restored | Outcome | Notes |
|---|---|---|---|---|
| _2026-MM-DD_ | _name_ | _kova-…dump_ | _OK / Issue_ | _link to workflow run_ |

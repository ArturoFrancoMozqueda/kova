# Supabase Backup Restore Drill - 2026-05-14

## Status

Blocked: Supabase daily backups are not confirmed active because the production Supabase organization is currently on the Free plan.

This beta hard gate is not complete.

## Production Project Checked

- Supabase organization: `PoS`
- Organization ID: `ixmmgbsbkmjwqzwxklhl`
- Organization plan observed via Supabase connector: `free`
- Production project: `PoS Project`
- Project ref: `qpgpwbhjuzszhrkhsjrn`
- Region: `us-west-1`
- Database host: `db.qpgpwbhjuzszhrkhsjrn.supabase.co`
- Database engine: Postgres `17`
- Project status: `ACTIVE_HEALTHY`

## Backup Requirement

The project requires active managed backups before onboarding the first beta tenant.

The current backup spec expects:

1. Supabase daily backups active.
2. Restore to a temporary Supabase project.
3. `alembic upgrade head` against the restored database.
4. Backend smoke test against the restored database.
5. At least 5 recent orders present in the restored dataset.
6. Result documented.
7. Temporary project deleted.

## Evidence

Supabase documentation reviewed through the Supabase docs connector:

- Supabase production checklist states that backups are not available for download for Free Plan projects, and that nightly backups for Pro Plan projects are available from the dashboard.
- Supabase database backup documentation states that all Pro, Team, and Enterprise projects are backed up automatically on a daily basis.
- Supabase PITR is available as an add-on for Pro, Team, and Enterprise projects.

Observed project state:

- Organization plan: `free`
- Production project is healthy, but no connector-visible backup schedule is available.
- Restore to a temporary project was not attempted because the managed daily backup prerequisite is not met.

## Source Database Smoke Snapshot

Read-only smoke checks against the current production database:

| Check | Result |
|---|---:|
| Alembic version in production | `0015_modifier_price_precision` |
| Repo migration head present locally | `0016_pmg_rls_policy` |
| Tenant rows | 8 |
| Order rows | 4 |
| Latest order timestamp | `2026-05-14 15:57:13.971388+00` |

Notes:

- The restore drill acceptance criterion requiring at least 5 recent orders would currently fail on restored data because production only has 4 orders.
- Production is also one migration behind the repo head. A restored database should be upgraded to `0016_pmg_rls_policy` during the drill.

## Required Next Steps

1. Upgrade the Supabase organization/project to a plan that supports scheduled daily backups before beta.
2. In Supabase Dashboard, open the production project and confirm **Database Backups > Scheduled backups** shows recent backups.
3. Record the selected restore point timestamp.
4. Restore the selected backup into a temporary Supabase project, not production.
5. Point a temporary backend configuration at the restored project's `DATABASE_URL`.
6. Run `alembic upgrade head` from `backend/`.
7. Run `pytest app/tests/test_health.py` from `backend/`.
8. Run a read-only restored-data smoke query:

   ```sql
   select
     (select count(*) from public.tenants) as tenants_count,
     (select count(*) from public.orders) as orders_count,
     (select max(created_at) from public.orders) as latest_order_at,
     (select version_num from public.alembic_version) as alembic_version;
   ```

9. Confirm the restored project has the expected tenant/order data and migration version.
10. Delete the temporary Supabase project after documenting the result.

## Decision

Do not mark the pre-beta backup drill checklist item complete until a managed daily backup exists and a restore into a temporary project has actually been smoke-tested.

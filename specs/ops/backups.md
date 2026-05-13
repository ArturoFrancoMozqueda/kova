# Backups Spec

## Database

**Provider:** Supabase (PostgreSQL)

**Built-in backups:**
- Daily automatic backups (Supabase Pro plan or higher)
- Point-in-time recovery (PITR) available on Pro+
- Retained for 7 days by default

**Verify before beta:**
1. Confirm backup schedule is active in Supabase dashboard → Settings → Backups
2. Confirm PITR is enabled if on Pro plan
3. Document the Supabase project ID and region for runbook

## Restore Drill (required before beta)

Steps:
1. Identify the target restore point (a recent daily backup)
2. Restore to a **temporary Supabase project** (not production)
3. Run `alembic upgrade head` against the restored DB to verify migrations apply
4. Run backend smoke tests (`pytest app/tests/test_health.py`) against the restored instance
5. Verify at least 5 recent orders exist in the restored dataset
6. Document result: restore time, data completeness, any issues
7. Delete the temporary project

## Application State (Fly.io)

The backend is stateless (all state in PostgreSQL). No Fly.io volume backups are needed.

## Acceptance Criteria

- Supabase daily backups confirmed active before beta launch.
- Restore drill completed and result documented.
- Runbook exists with step-by-step restore instructions.

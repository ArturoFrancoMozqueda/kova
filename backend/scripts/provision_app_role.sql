-- Provision the least-privilege application role `kova_app`.
--
-- WHY: The backend must connect to Postgres as a NON-owner, NON-superuser role
-- so that Row-Level Security (RLS) tenant_isolation policies actually apply at
-- runtime. The table owner / superuser bypasses ENABLE ROW LEVEL SECURITY, and
-- even FORCE ROW LEVEL SECURITY is bypassed by superusers and roles with
-- BYPASSRLS. `kova_app` is explicitly NOSUPERUSER NOBYPASSRLS, so every
-- tenant_isolation policy is enforced against it. See PLAN-02 and ADR-009.
--
-- WHERE THIS RUNS:
--   * Local dev / CI: against the docker/CI Postgres, as the superuser `pos`.
--   * Supabase (staging/prod): as the project owner role (`postgres`), which
--     retains BYPASSRLS — run this once from the SQL editor or via psql.
--
-- SECRETS: the role password is NEVER committed. Pass it as a psql variable:
--   psql "$MIGRATION_DATABASE_URL" \
--     -v kova_app_password="$KOVA_APP_DB_PASSWORD" \
--     -f backend/scripts/provision_app_role.sql
-- In local/CI the password is a throwaway dev value (see docker-compose / CI).
--
-- IDEMPOTENT: safe to re-run. Creates the role if missing, otherwise only
-- (re)applies grants and refreshes the password.

\set ON_ERROR_STOP on

-- 1. Role (created without a password if none is supplied; grants still apply).
DO
$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
        CREATE ROLE kova_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END IF;
END
$$;

-- 2. Refresh the password when one is provided (skipped if the variable is unset).
\if :{?kova_app_password}
ALTER ROLE kova_app WITH PASSWORD :'kova_app_password';
\endif

-- 3. Connect + schema usage.
GRANT CONNECT ON DATABASE :"DBNAME" TO kova_app;
GRANT USAGE ON SCHEMA public TO kova_app;

-- 4. CRUD on every existing domain table + sequence. RLS still constrains rows;
--    these grants only permit the *operation*, not cross-tenant visibility.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kova_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kova_app;

-- 5. Future tables/sequences (created by later migrations, run as the owner)
--    are granted automatically so a new migration never silently breaks the app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO kova_app;

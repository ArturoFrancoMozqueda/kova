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

-- 6. Fiscal history is append-only. Reconcile every fiscal table that exists
--    at the current migration revision so re-running this script cannot reopen
--    UPDATE/DELETE. The existence check keeps provisioning compatible with a
--    database that is intentionally stopped at an older revision.
--
--    PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE; granting
--    only the immutable id column permits row locks while mutation remains
--    blocked by the fiscal immutability triggers.
DO
$$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'order_fiscal_snapshots',
        'order_item_fiscal_snapshots',
        'order_item_tax_snapshots',
        'fiscal_global_draft_settings',
        'fiscal_global_draft_batches',
        'fiscal_global_draft_orders',
        'fiscal_individual_invoice_events',
        'fiscal_global_draft_adjustments'
    ]
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON TABLE %I FROM kova_app', table_name);
            IF table_name = 'fiscal_global_draft_settings' THEN
                EXECUTE format(
                    'GRANT SELECT, INSERT, UPDATE ON TABLE %I TO kova_app', table_name
                );
            ELSE
                EXECUTE format(
                    'GRANT SELECT, INSERT ON TABLE %I TO kova_app', table_name
                );
            END IF;
            IF table_name IN ('order_fiscal_snapshots', 'fiscal_global_draft_batches') THEN
                EXECUTE format(
                    'GRANT UPDATE (id) ON TABLE %I TO kova_app', table_name
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

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

-- 4. Start from no table/sequence privileges. New tables require an explicit
-- decision in this inventory, so reprovisioning cannot reopen internal tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kova_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kova_app;
REVOKE CREATE ON SCHEMA public FROM kova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM kova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM kova_app;

-- Supabase Data API roles have no direct-table contract in Kova.
DO
$$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
            EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
        END IF;
    END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- 5. Explicit runtime matrix. Missing tables are skipped for compatibility
-- with databases intentionally stopped at an older migration revision.
DO
$$
DECLARE
    table_name text;
    privilege_list text;
BEGIN
    FOR table_name, privilege_list IN
        SELECT * FROM (VALUES
            ('account_deletion_requests', 'SELECT, INSERT, UPDATE, DELETE'),
            ('categories', 'SELECT, INSERT, UPDATE, DELETE'),
            ('customer_order_item_modifiers', 'SELECT, INSERT, UPDATE, DELETE'),
            ('customer_order_items', 'SELECT, INSERT, UPDATE, DELETE'),
            ('customer_orders', 'SELECT, INSERT, UPDATE, DELETE'),
            ('expenses', 'SELECT, INSERT, UPDATE, DELETE'),
            ('inventory_reservations', 'SELECT, INSERT, UPDATE, DELETE'),
            ('membership_invitations', 'SELECT, INSERT, UPDATE, DELETE'),
            ('modifier_groups', 'SELECT, INSERT, UPDATE, DELETE'),
            ('modifier_options', 'SELECT, INSERT, UPDATE, DELETE'),
            ('product_image_files', 'SELECT, INSERT, UPDATE, DELETE'),
            ('product_modifier_groups', 'SELECT, INSERT, UPDATE, DELETE'),
            ('products', 'SELECT, INSERT, UPDATE, DELETE'),
            ('tenant_business_profiles', 'SELECT, INSERT, UPDATE, DELETE'),
            ('tenant_logo_files', 'SELECT, INSERT, UPDATE, DELETE'),
            ('tenant_onboarding_state', 'SELECT, INSERT, UPDATE, DELETE'),
            ('tenant_receipt_settings', 'SELECT, INSERT, UPDATE, DELETE'),
            ('idempotency_keys', 'SELECT, INSERT, UPDATE'),
            ('memberships', 'SELECT, INSERT, UPDATE'),
            ('orders', 'SELECT, INSERT, UPDATE'),
            ('sessions', 'SELECT, INSERT, UPDATE'),
            ('shifts', 'SELECT, INSERT, UPDATE'),
            ('subscriptions', 'SELECT, INSERT, UPDATE'),
            ('audit_logs', 'SELECT, INSERT'),
            ('cash_movements', 'SELECT, INSERT'),
            ('inventory_movements', 'SELECT, INSERT'),
            ('order_item_modifiers', 'SELECT, INSERT'),
            ('order_items', 'SELECT, INSERT'),
            ('payments', 'SELECT, INSERT'),
            ('refund_items', 'SELECT, INSERT'),
            ('refunds', 'SELECT, INSERT'),
            ('telemetry_events', 'SELECT, INSERT'),
            ('voids', 'SELECT, INSERT'),
            ('order_fiscal_snapshots', 'SELECT, INSERT'),
            ('order_item_fiscal_snapshots', 'SELECT, INSERT'),
            ('order_item_tax_snapshots', 'SELECT, INSERT'),
            ('fiscal_global_draft_batches', 'SELECT, INSERT'),
            ('fiscal_global_draft_orders', 'SELECT, INSERT'),
            ('fiscal_individual_invoice_events', 'SELECT, INSERT'),
            ('fiscal_global_draft_adjustments', 'SELECT, INSERT'),
            ('fiscal_global_draft_settings', 'SELECT, INSERT, UPDATE'),
            ('anonymous_telemetry_events', 'INSERT'),
            ('tenants', 'SELECT'),
            ('users', 'SELECT')
        ) AS grants(table_name, privilege_list)
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('GRANT %s ON TABLE %I TO kova_app', privilege_list, table_name);
        END IF;
    END LOOP;
END
$$;

-- Business profile updates mirror public_name onto the owning tenant. Keep the
-- grant column-scoped so runtime cannot alter slug, lifecycle or feature flags.
GRANT UPDATE (name, updated_at) ON TABLE tenants TO kova_app;

-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE. Limiting it
-- to immutable id columns permits row locks while triggers reject mutation.
DO
$$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'order_fiscal_snapshots', 'fiscal_global_draft_batches'
    ] LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format('GRANT UPDATE (id) ON TABLE %I TO kova_app', table_name);
        END IF;
    END LOOP;
END
$$;

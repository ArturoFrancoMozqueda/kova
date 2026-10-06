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
-- PostgreSQL's built-in PUBLIC function grant is global. A schema-scoped
-- REVOKE cannot override it, so this statement intentionally omits IN SCHEMA.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Supabase Data API roles have no direct-table contract in Kova.
DO
$$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
            EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', role_name);
        END IF;
    END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Supabase owns provider-created objects as `supabase_admin`. Its managed
-- defaults historically granted Data API roles access to every new object,
-- independently from the defaults of the `postgres` migration owner above.
-- Kova has no direct Data API contract, so close that future-object path too.
DO
$$
DECLARE role_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
       AND pg_has_role(current_user, 'supabase_admin', 'USAGE') THEN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
                    role_name
                );
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
                    role_name
                );
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
                    role_name
                );
            END IF;
        END LOOP;
        ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
            REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        RAISE NOTICE 'supabase_admin defaults require the Data API exposure setting to be disabled in the Supabase dashboard';
    END IF;
END
$$;

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
            ('account_deletion_requests', 'SELECT, INSERT, UPDATE'),
            ('categories', 'SELECT, INSERT, UPDATE'),
            ('branches', 'SELECT, INSERT'),
            ('customers', 'SELECT, INSERT, UPDATE'),
            ('suppliers', 'SELECT, INSERT'),
            ('purchase_orders', 'SELECT, INSERT'),
            ('purchase_order_items', 'SELECT, INSERT'),
            ('inventory_transfers', 'SELECT, INSERT'),
            ('fiscal_issuer_profiles', 'SELECT, INSERT'),
            ('invoice_requests', 'SELECT, INSERT'),
            ('cfdi_connections', 'SELECT, INSERT'),
            ('cfdi_documents', 'SELECT, INSERT'),
            ('customer_order_item_modifiers', 'SELECT, INSERT, DELETE'),
            ('customer_order_items', 'SELECT, INSERT, DELETE'),
            ('customer_orders', 'SELECT, INSERT, UPDATE'),
            ('expenses', 'SELECT, INSERT, UPDATE, DELETE'),
            ('inventory_reservations', 'SELECT, INSERT, UPDATE'),
            ('membership_invitations', 'SELECT, INSERT, UPDATE'),
            ('modifier_groups', 'SELECT, INSERT, UPDATE'),
            ('modifier_options', 'SELECT, INSERT, UPDATE'),
            ('product_image_files', 'SELECT, INSERT, UPDATE, DELETE'),
            ('product_modifier_groups', 'SELECT, INSERT, DELETE'),
            ('products', 'SELECT, INSERT, UPDATE'),
            ('tenant_business_profiles', 'SELECT, INSERT, UPDATE'),
            ('tenant_logo_files', 'SELECT, INSERT, UPDATE, DELETE'),
            ('tenant_onboarding_state', 'SELECT, INSERT, UPDATE'),
            ('tenant_receipt_settings', 'SELECT, INSERT, UPDATE'),
            ('idempotency_keys', 'SELECT, INSERT, UPDATE'),
            ('memberships', 'SELECT, UPDATE'),
            ('orders', 'SELECT, INSERT, UPDATE'),
            ('sessions', 'SELECT, UPDATE'),
            ('shifts', 'SELECT, INSERT, UPDATE'),
            ('subscriptions', 'SELECT, INSERT, UPDATE'),
            ('audit_logs', 'INSERT'),
            ('cash_movements', 'SELECT, INSERT'),
            ('inventory_movements', 'SELECT, INSERT'),
            ('order_item_modifiers', 'SELECT, INSERT'),
            ('order_items', 'SELECT, INSERT'),
            ('payments', 'SELECT, INSERT'),
            ('refund_items', 'SELECT, INSERT'),
            ('refunds', 'SELECT, INSERT'),
            ('telemetry_events', 'INSERT'),
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

DO $$ BEGIN
    IF to_regclass('public.purchase_orders') IS NOT NULL THEN
        GRANT UPDATE (status) ON TABLE purchase_orders TO kova_app;
        GRANT UPDATE (received_quantity) ON TABLE purchase_order_items TO kova_app;
    END IF;
    IF to_regclass('public.fiscal_issuer_profiles') IS NOT NULL THEN
        GRANT UPDATE (fiscal_data) ON TABLE fiscal_issuer_profiles TO kova_app;
    END IF;
    IF to_regclass('public.cfdi_connections') IS NOT NULL THEN
        GRANT UPDATE (organization_id, encrypted_api_key, issuer_rfc, production_ready,
            certificate_expires_at, refreshed_at) ON cfdi_connections TO kova_app;
        GRANT UPDATE (state, provider_id, uuid, xml_bytes, last_error_code, cancellation_status,
            cancellation_key, cancellation_hash, cancellation_payload, confirmed_at, canceled_at,
            updated_at) ON cfdi_documents TO kova_app;
    END IF;
    IF to_regclass('public.branches') IS NOT NULL THEN
        GRANT UPDATE (name, address) ON TABLE branches TO kova_app;
    END IF;
END $$;

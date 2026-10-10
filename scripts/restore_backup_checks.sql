-- Runs only in the disconnected, disposable restore container. No row data is output.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    chosen uuid;
    expected bigint;
    seen bigint;
    table_row record;
BEGIN
    IF current_database() <> 'kova_restore' OR current_user <> 'restore_owner' THEN
        RAISE EXCEPTION 'Unexpected restore database identity';
    END IF;
    IF (SELECT count(*) FROM public.orders) < 5 THEN
        RAISE EXCEPTION 'Backup does not contain five orders';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
    ) THEN RAISE EXCEPTION 'Restored public table lacks RLS'; END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'ops_notes'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='tenant_id' AND NOT a.attisdropped)
        AND NOT c.relforcerowsecurity
    ) THEN RAISE EXCEPTION 'Restored tenant table lacks FORCE RLS'; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app' AND (rolsuper OR rolbypassrls))
        OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
        RAISE EXCEPTION 'Runtime role is not least privilege';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
    ) THEN RAISE EXCEPTION 'Restored Data API role has table privileges'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.orders o LEFT JOIN public.payments p
        ON p.tenant_id=o.tenant_id AND p.order_id=o.id
        GROUP BY o.id,o.total_amount HAVING COALESCE(sum(p.amount_amount),0) <> o.total_amount
    ) THEN RAISE EXCEPTION 'Restored payments do not reconcile'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.inventory_movements m LEFT JOIN public.inventory_lot_allocations a
        ON a.tenant_id=m.tenant_id AND a.movement_id=m.id
        GROUP BY m.id,m.lot_tracked,m.quantity_delta
        HAVING (m.lot_tracked OR COALESCE(sum(a.quantity_delta),0) <> 0)
               AND COALESCE(sum(a.quantity_delta),0) <> m.quantity_delta
    ) THEN RAISE EXCEPTION 'Restored lot movements do not reconcile'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.inventory_lot_allocations
        GROUP BY tenant_id,branch_id,lot_id HAVING sum(quantity_delta) < 0
    ) THEN RAISE EXCEPTION 'Restored lot stock is negative'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.inventory_reservations r LEFT JOIN public.inventory_lot_reservations l
        ON l.tenant_id=r.tenant_id AND l.reservation_id=r.id
        GROUP BY r.id,r.lot_tracked,r.quantity
        HAVING (r.lot_tracked OR COALESCE(sum(l.quantity),0) <> 0)
               AND COALESCE(sum(l.quantity),0) <> r.quantity
    ) THEN RAISE EXCEPTION 'Restored lot reservations do not reconcile'; END IF;

    SELECT tenant_id INTO chosen FROM public.orders GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1;
    SELECT count(*) INTO expected FROM public.orders WHERE tenant_id=chosen;
    -- Test the actual restored policies, rather than trusting their presence in a dump.
    EXECUTE 'SET LOCAL ROLE kova_app';
    PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000000',true);
    FOR table_row IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
        AND has_table_privilege(current_user,c.oid,'SELECT')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='tenant_id' AND NOT a.attisdropped)
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_row.relname) INTO seen;
        IF seen <> 0 THEN RAISE EXCEPTION 'Empty tenant scope reveals rows'; END IF;
    END LOOP;
    PERFORM set_config('app.tenant_id',chosen::text,true);
    SELECT count(*) INTO seen FROM public.orders;
    IF seen <> expected THEN RAISE EXCEPTION 'Restored scoped orders mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM public.orders WHERE tenant_id <> chosen) THEN
        RAISE EXCEPTION 'Restored tenant scope reveals foreign orders';
    END IF;
    EXECUTE 'RESET ROLE';
END $$;
SELECT json_build_object(
    'revision',(SELECT version_num FROM public.alembic_version),
    'tenants',(SELECT count(*) FROM public.tenants),
    'orders',(SELECT count(*) FROM public.orders),
    'orders_last_seven_days',(SELECT count(*) FROM public.orders WHERE created_at >= now()-interval '7 days'),
    'latest_order_at',(SELECT max(created_at) FROM public.orders),
    'products',(SELECT count(*) FROM public.products),
    'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
    'assistant_control_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='assistant_control'),
    'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
    'validated_foreign_keys',(SELECT count(*) FROM pg_constraint WHERE contype='f' AND convalidated),
    'legacy_unvalidated_foreign_keys',(SELECT count(*) FROM pg_constraint WHERE contype='f' AND NOT convalidated),
    'rls_scope_checks',true,
    'payment_and_lot_integrity',true,
    'data_api_grants',0
);
ROLLBACK;

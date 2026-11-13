"""Catalog guard: every public table that carries ``tenant_id`` has RLS enabled
AND forced, so even the table owner's sessions are filtered by tenant.

Mirrors the post-restore drill in ``scripts/restore_backup_checks.sql`` but runs
on every CI build against the migrated schema, so a new tenant table that
forgets ``FORCE ROW LEVEL SECURITY`` fails before it ships.
"""

from sqlalchemy import text

# Each exception needs a reason. Backend-only tables are never granted to the
# runtime role (see `_BACKEND_ONLY_TABLES` in migration 0065); they are reached
# only by the privileged ops engine, and RLS is still enabled with no runtime
# policy, so `kova_app` would see nothing even if a grant leaked.
FORCE_RLS_EXCEPTIONS = {
    # Founder-only operator notes that may reference a tenant. Read and written
    # exclusively through the privileged ops routes (internal admin + MFA).
    "ops_notes": "backend-only operator notes; no kova_app grant",
}

_TENANT_TABLES_SQL = text(
    """
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
            AND a.attnum > 0 AND NOT a.attisdropped
      )
    ORDER BY c.relname
    """
)


def test_every_tenant_table_has_enabled_and_forced_rls(owner_engine):
    with owner_engine.connect() as conn:
        rows = conn.execute(_TENANT_TABLES_SQL).all()

    assert len(rows) > 50, "catalog query found suspiciously few tenant tables"
    tables = {name for name, _, _ in rows}
    stale = set(FORCE_RLS_EXCEPTIONS) - tables
    assert not stale, f"remove exceptions for tables without tenant_id: {sorted(stale)}"

    not_enabled = [name for name, enabled, _ in rows if not enabled]
    assert not not_enabled, f"tenant tables without RLS: {not_enabled}"

    not_forced = [
        name for name, _, forced in rows if not forced and name not in FORCE_RLS_EXCEPTIONS
    ]
    assert not not_forced, f"tenant tables without FORCE RLS: {not_forced}"


def test_force_rls_exceptions_are_unreachable_by_runtime_role(owner_engine, kova_app_engine):
    # `kova_app_engine` provisions the least-privilege runtime role and grants.
    del kova_app_engine
    with owner_engine.connect() as conn:
        for table in FORCE_RLS_EXCEPTIONS:
            granted = conn.execute(
                text(
                    "SELECT has_table_privilege('kova_app', :t, 'SELECT')"
                    " OR has_table_privilege('kova_app', :t, 'INSERT')"
                    " OR has_table_privilege('kova_app', :t, 'UPDATE')"
                    " OR has_table_privilege('kova_app', :t, 'DELETE')"
                ),
                {"t": f"public.{table}"},
            ).scalar_one()
            assert granted is False, f"{table} is exempt from FORCE RLS but kova_app can reach it"

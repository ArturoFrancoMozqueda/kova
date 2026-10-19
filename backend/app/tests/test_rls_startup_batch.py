"""Compare the batched RLS snapshot to its former four-query implementation."""
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app import db as database


def _legacy(conn):
    params = {"tables": list(database.RLS_PROTECTED_TABLES)}
    role = conn.execute(text(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
    )).one()
    owned = set(conn.execute(text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND c.relkind='r' "
        "AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) "
        "AND c.relname=ANY(:tables)"
    ), params).scalars())
    posture = conn.execute(text(
        "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity, "
        "COALESCE(bool_or(p.polqual IS NOT NULL),false), "
        "COALESCE(bool_or(p.polwithcheck IS NOT NULL),false) "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "LEFT JOIN pg_policy p ON p.polrelid=c.oid "
        "WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY(:tables) "
        "GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity"
    ), params).all()
    policies = conn.execute(text(
        "SELECT c.relname,p.polname,p.polpermissive,p.polcmd,p.polroles::bigint[], "
        "p.polqual IS NOT NULL,p.polwithcheck IS NOT NULL, "
        "pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid) "
        "FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid "
        "JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND c.relname=ANY(:tables)"
    ), params).all()
    return {
        "role_is_super": bool(role[0]), "role_bypasses_rls": bool(role[1]),
        "owned_tables": owned,
        "table_posture": {r[0]: tuple(bool(x) for x in r[1:]) for r in posture},
        "policy_catalog": {
            table: [(name, bool(permissive), command, tuple(roles), bool(using), bool(check), ue, ce)
                    for rel, name, permissive, command, roles, using, check, ue, ce in policies
                    if rel == table]
            for table in database.RLS_PROTECTED_TABLES
        },
    }


def _canonical(snapshot):
    return {**snapshot, "policy_catalog": {
        table: sorted(rows, key=repr) for table, rows in snapshot["policy_catalog"].items()
    }}


def _batch(conn, monkeypatch):
    captured, statements = {}, []

    class Reader:
        def execute(self, statement, params):
            statements.append(str(statement))
            return conn.execute(statement, params)

    @contextmanager
    def connect():
        yield Reader()

    def capture(**kwargs):
        captured.update(kwargs)
        return []

    with monkeypatch.context() as patch:
        patch.setattr(database, "engine", SimpleNamespace(connect=connect))
        patch.setattr(database, "_rls_posture_errors", capture)
        database.assert_rls_active()
    assert len(statements) == 1
    assert captured
    return captured


def _compare(conn, monkeypatch):
    legacy, actual = _legacy(conn), _batch(conn, monkeypatch)
    assert _canonical(actual) == _canonical(legacy)
    errors = database._rls_posture_errors(**actual)
    assert errors == database._rls_posture_errors(**legacy)
    return actual, errors


@pytest.mark.parametrize("driver", ["psycopg", "pg8000"])
@pytest.mark.parametrize("as_runtime", [False, True])
def test_real_role_catalog_inputs_match_legacy(
    owner_engine, kova_app_engine, monkeypatch, driver, as_runtime,
):
    engine = create_engine(owner_engine.url.set(drivername=f"postgresql+{driver}"),
                           poolclass=NullPool)
    try:
        with engine.begin() as conn:
            if as_runtime:
                conn.execute(text("SET LOCAL ROLE kova_app"))
            _, errors = _compare(conn, monkeypatch)
            if as_runtime:
                assert errors == []
            else:
                assert any("superuser" in error for error in errors)
    finally:
        engine.dispose()


@pytest.mark.parametrize("driver", ["psycopg", "pg8000"])
@pytest.mark.parametrize(("mutation", "expected"), [
    ("ALTER TABLE products DISABLE ROW LEVEL SECURITY", "products: missing RLS"),
    ("ALTER TABLE products NO FORCE ROW LEVEL SECURITY", "FORCE RLS"),
    ("DROP POLICY tenant_isolation ON products", "expected exactly one tenant_isolation"),
    ("ALTER POLICY tenant_isolation ON products USING (true) WITH CHECK (true)",
     "unsafe expression"),
    ("CREATE POLICY extra_permissive ON products USING (true) WITH CHECK (true)",
     "unexpected permissive policies"),
    ("ALTER POLICY tenant_isolation ON products TO kova_app", "unsafe scope"),
    ("ALTER TABLE products OWNER TO kova_app", "owns tenant tables"),
    ("ALTER TABLE products RENAME TO startup_batch_missing_products", "products: table missing"),
])
def test_invalid_catalogs_keep_identical_inputs_and_errors(
    owner_engine, kova_app_engine, monkeypatch, driver, mutation, expected,
):
    engine = create_engine(owner_engine.url.set(drivername=f"postgresql+{driver}"),
                           poolclass=NullPool)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                conn.execute(text(mutation))
                conn.execute(text("SET LOCAL ROLE kova_app"))
                _, errors = _compare(conn, monkeypatch)
                assert any(expected in error for error in errors)
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


@pytest.mark.parametrize("driver", ["psycopg", "pg8000"])
def test_partition_policies_remain_in_inventory_but_not_ordinary_table_posture(
    owner_engine, kova_app_engine, monkeypatch, driver,
):
    table = "startup_batch_partitioned_probe"
    monkeypatch.setattr(database, "RLS_PROTECTED_TABLES", (*database.RLS_PROTECTED_TABLES, table))
    monkeypatch.setattr(database, "EXPECTED_RLS_POLICY_SPECS", {
        **database.EXPECTED_RLS_POLICY_SPECS, table: database.EXPECTED_RLS_POLICY_SPECS["products"],
    })
    engine = create_engine(owner_engine.url.set(drivername=f"postgresql+{driver}"),
                           poolclass=NullPool)
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                conn.execute(text(f"CREATE TABLE {table} (id integer) PARTITION BY RANGE (id)"))
                conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
                conn.execute(text(f"CREATE POLICY tenant_isolation ON {table} USING (true)"))
                conn.execute(text("SET LOCAL ROLE kova_app"))
                actual, errors = _compare(conn, monkeypatch)
                assert actual["policy_catalog"][table]
                assert table not in actual["table_posture"]
                assert f"{table}: table missing" in errors
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


@pytest.mark.parametrize(("role_super", "role_bypass", "expected"), [
    (True, False, "superuser"), (False, True, "BYPASSRLS"),
])
def test_flat_role_flags_fail_closed(monkeypatch, role_super, role_bypass, expected):
    row = (role_super, role_bypass, None, None, None, None, None,
           None, None, None, None, False, False, None, None)

    @contextmanager
    def connect():
        yield SimpleNamespace(execute=lambda *_args: SimpleNamespace(all=lambda: [row]))

    monkeypatch.setattr(database, "engine", SimpleNamespace(connect=connect))
    monkeypatch.setattr(database.settings, "app_env", "production")
    with pytest.raises(RuntimeError, match=expected):
        database.assert_rls_active()


@pytest.mark.parametrize("failure", ["empty", "execute"])
def test_missing_role_or_query_failure_is_not_accepted_in_production(monkeypatch, failure):
    def execute(*_args):
        if failure == "execute":
            raise OSError("synthetic catalog transport failure")
        return SimpleNamespace(all=lambda: [])

    @contextmanager
    def connect():
        yield SimpleNamespace(execute=execute)

    monkeypatch.setattr(database, "engine", SimpleNamespace(connect=connect))
    monkeypatch.setattr(database.settings, "app_env", "production")
    with pytest.raises(RuntimeError, match="Could not verify RLS posture at startup"):
        database.assert_rls_active()

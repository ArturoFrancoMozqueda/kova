"""Sharing a live startup catalog saves one connection without skipping guards."""
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from app import db, main
from app.assistant.access import assert_private_policies


def _private_rows(catalog):
    return sorted(
        (table, name, permissive, command, tuple(roles), using, check)
        for table in ("assistant_records", "assistant_chunks")
        for name, permissive, command, roles, _using, _check, using, check
        in catalog[table]
    )


def test_create_app_reads_one_connection_and_both_guards(kova_app_engine, monkeypatch):
    engine = create_engine(kova_app_engine.url, poolclass=NullPool)
    connections, statements = [], []
    event.listen(engine, "connect", lambda *_: connections.append(True))
    event.listen(engine, "before_cursor_execute", lambda _c, _cu, sql, *_: statements.append(sql))
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db.settings, "app_env", "production")
    for name in ("configure_logging", "init_sentry", "_validate_config"):
        monkeypatch.setattr(main, name, lambda: None)
    completed = []
    original = main.assert_private_policies

    def acl(**kwargs):
        assert kwargs["policy_catalog"] is not None
        original(**kwargs)
        completed.append("acl")

    monkeypatch.setattr(main, "assert_private_policies", acl)
    monkeypatch.setattr(main, "_construct_app", lambda: completed.append("app"))
    try:
        main.create_app()
        assert completed == ["acl", "app"]
        assert len(connections) == 1
        assert len(statements) == 1
        assert "FROM pg_roles" in statements[0]
    finally:
        engine.dispose()


@pytest.mark.parametrize("mutation", [
    None,
    "DROP POLICY assistant_private_read ON assistant_records",
    "ALTER POLICY assistant_private_read ON assistant_records USING (true)",
    "ALTER POLICY assistant_private_read ON assistant_records TO kova_app",
    "ALTER POLICY assistant_private_insert ON assistant_records WITH CHECK (true)",
    "DROP POLICY assistant_chunk_update ON assistant_chunks",
    "ALTER TABLE assistant_chunks RENAME TO startup_snapshot_missing_chunks",
    "DROP POLICY assistant_private_read ON assistant_records; "
    "CREATE POLICY assistant_private_read ON assistant_records AS PERMISSIVE "
    "FOR SELECT USING (owner_user_id::text = current_setting('app.assistant_user_id', true) OR shared)",
    "DROP POLICY assistant_private_read ON assistant_records; "
    "CREATE POLICY assistant_private_read ON assistant_records AS RESTRICTIVE FOR ALL "
    "USING (owner_user_id::text = current_setting('app.assistant_user_id', true) OR shared) "
    "WITH CHECK (owner_user_id::text = current_setting('app.assistant_user_id', true))",
])
def test_projection_and_acl_outcomes_match_standalone_catalog(
    owner_engine, kova_app_engine, monkeypatch, mutation,
):
    monkeypatch.setattr(db.settings, "app_env", "production")
    with owner_engine.connect() as conn:
        transaction = conn.begin()
        try:
            if mutation:
                for statement in mutation.split(";"):
                    conn.exec_driver_sql(statement)
            conn.exec_driver_sql("SET LOCAL ROLE kova_app")
            results = []

            class Reader:
                def execute(self, statement, *args, **kwargs):
                    rows = conn.execute(statement, *args, **kwargs).all()
                    results.append(rows)
                    return SimpleNamespace(all=lambda: rows)

            @contextmanager
            def connect():
                yield Reader()

            monkeypatch.setattr(db, "engine", SimpleNamespace(connect=connect))
            # Capture the full unaltered catalog even when canonical RLS rejects
            # a missing table; restrictive ACL must reject that snapshot too.
            catalogs = []
            original = db._rls_posture_errors

            def canonical(**kwargs):
                catalogs.append(kwargs["policy_catalog"])
                return original(**kwargs)

            monkeypatch.setattr(db, "_rls_posture_errors", canonical)
            try:
                catalog = db.assert_rls_active()
            except RuntimeError:
                assert mutation and ("RENAME" in mutation or "PERMISSIVE" in mutation)
                catalog = catalogs[0]
            assert catalog is not None
            outcomes = []
            for shared in (False, True):
                try:
                    assert_private_policies(**({"policy_catalog": catalog} if shared else {}))
                    outcomes.append("accepted")
                except RuntimeError as exc:
                    assert str(exc) == "Could not verify assistant ACL at startup"
                    outcomes.append("rejected")
            assert outcomes == ["rejected" if mutation else "accepted"] * 2
            standalone_rows = sorted(
                (r[0], r[1], r[2], r[3], tuple(r[4]), r[5], r[6]) for r in results[-1]
            )
            assert _private_rows(catalog) == standalone_rows
            assert len(results) == 2  # RLS read + standalone ACL; shared ACL reads nothing.
        finally:
            transaction.rollback()


def test_empty_shared_catalog_fails_closed_without_connection(monkeypatch):
    monkeypatch.setattr(db.settings, "app_env", "production")
    monkeypatch.setattr(db, "engine", SimpleNamespace(
        connect=lambda: pytest.fail("An explicit empty snapshot must be validated, not replaced")
    ))
    with pytest.raises(RuntimeError, match="Could not verify assistant ACL"):
        assert_private_policies(policy_catalog={})


def test_local_rls_failure_keeps_standalone_acl_read(monkeypatch):
    calls = []

    def failed_read():
        calls.append("connect")
        raise RuntimeError("synthetic unavailable")

    monkeypatch.setattr(db, "engine", SimpleNamespace(connect=failed_read))
    monkeypatch.setattr(db.settings, "app_env", "local")
    catalog = db.assert_rls_active()
    assert catalog is None
    assert_private_policies(policy_catalog=catalog)
    assert calls == ["connect", "connect"]

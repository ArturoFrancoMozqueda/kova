"""Only source-defined catalog names use SQLAlchemy's typed literal rendering."""
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, text

from app import db


def _catalog_statement(monkeypatch):
    captured = []

    def execute(statement, parameters):
        captured.append((statement, parameters))
        raise OSError("synthetic statement capture only")

    @contextmanager
    def connect():
        yield SimpleNamespace(execute=execute)

    with monkeypatch.context() as patch:
        patch.setattr(db, "engine", SimpleNamespace(connect=connect))
        patch.setattr(db.settings, "app_env", "production")
        with pytest.raises(RuntimeError, match="Could not verify RLS posture"):
            db.assert_rls_active()
    assert len(captured) == 1
    return captured[0]


def test_source_inventory_compiles_without_dbapi_parameters(owner_engine, monkeypatch):
    statement, supplied = _catalog_statement(monkeypatch)
    compiled = statement.compile(
        dialect=owner_engine.dialect, compile_kwargs={"render_postcompile": True},
    )
    assert supplied == compiled.params == {}
    assert "ANY(ARRAY[" in str(compiled)
    assert "POSTCOMPILE" not in str(compiled)
    parameter = statement._bindparams["tables"]
    assert parameter.literal_execute
    assert parameter.value == list(db.RLS_PROTECTED_TABLES)


@pytest.mark.parametrize("standard_strings", ["on", "off"])
def test_typed_rendering_round_trips_quotes_backslashes_and_unicode(
    owner_engine, monkeypatch, standard_strings,
):
    names = ("products", "synthetic'quote", "synthetic\\backslash", "sintético")
    monkeypatch.setattr(db, "RLS_PROTECTED_TABLES", names)
    statement, _ = _catalog_statement(monkeypatch)
    # Exercise the exact inventory bind/type against the live CI profile, with
    # strings as values only. No SQL or relation is created from these names.
    probe = text("SELECT :tables").bindparams(statement._bindparams["tables"])
    sent = []

    def record(_conn, _cursor, _statement, parameters, *_args):
        sent.append(parameters)

    options = {"options": f"-c standard_conforming_strings={standard_strings}"}
    connect_args = {"startup_params": options} if owner_engine.dialect.driver == "pg8000" else options
    # The server setting is established before dialect initialization, so both
    # the live GUC and SQLAlchemy's escaping capability match this connection.
    engine = create_engine(owner_engine.url, connect_args=connect_args)
    try:
        with engine.connect() as conn:
            assert conn.exec_driver_sql("SHOW standard_conforming_strings").scalar() == standard_strings
            assert engine.dialect._backslash_escapes is (standard_strings == "off")
            event.listen(conn, "before_cursor_execute", record)
            try:
                assert conn.scalar(probe) == list(names)
            finally:
                event.remove(conn, "before_cursor_execute", record)
        assert len(sent) == 1 and not sent[0]
    finally:
        engine.dispose()

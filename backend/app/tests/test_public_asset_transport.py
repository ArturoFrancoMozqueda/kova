"""Public SELECT transport reuses the pool without changing transactional callers."""

from unittest.mock import MagicMock

import psycopg
import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from app import db


def fresh_session(monkeypatch):
    engine = MagicMock()
    engine.dialect.name = "postgresql"
    engine.dialect.driver = "psycopg"
    monkeypatch.setattr(db, "privileged_engine", engine)
    monkeypatch.setattr(db.sys, "platform", "linux")
    session = MagicMock()
    session.get_bind.return_value = engine
    session.in_transaction.return_value = False
    session.info = {}
    session.new = session.dirty = session.deleted = set()
    return session


def test_fresh_public_asset_read_uses_existing_privileged_pool(monkeypatch):
    session = fresh_session(monkeypatch)
    db.prepare_public_asset_read(session)
    session.connection.assert_called_once_with(execution_options={"isolation_level": "AUTOCOMMIT"})


@pytest.mark.parametrize("scope", ["transaction", "tenant", "assistant", "new", "dirty", "deleted"])
def test_existing_transactions_scopes_and_pending_writes_are_untouched(monkeypatch, scope):
    session = fresh_session(monkeypatch)
    if scope == "transaction":
        session.in_transaction.return_value = True
    elif scope in {"tenant", "assistant"}:
        session.info = {f"kova_{scope}_id": "synthetic"}
    else:
        setattr(session, scope, {object()})
    db.prepare_public_asset_read(session)
    session.connection.assert_not_called()


@pytest.mark.parametrize("transport", ["workers", "pg8000", "sqlite", "runtime"])
def test_other_transports_and_runtime_engine_are_untouched(monkeypatch, transport):
    session = fresh_session(monkeypatch)
    if transport == "workers":
        monkeypatch.setattr(db.sys, "platform", "emscripten")
    elif transport == "runtime":
        session.get_bind.return_value = MagicMock()
    elif transport == "sqlite":
        db.privileged_engine.dialect.name = "sqlite"
    else:
        db.privileged_engine.dialect.driver = "pg8000"
    db.prepare_public_asset_read(session)
    session.connection.assert_not_called()


def test_public_read_removes_transaction_commands_and_restores_auth_rollback(owner_engine, monkeypatch):
    """Real psycopg commands on one connection; no application rows are touched."""
    commands = []

    class TracedConnection(psycopg.Connection):
        def _exec_command(self, command, *args, **kwargs):
            if isinstance(command, bytes):
                verb = command.split(maxsplit=1)[0]
                if verb in {b"BEGIN", b"ROLLBACK"}:
                    commands.append(verb.decode("ascii"))
            return (yield from super()._exec_command(command, *args, **kwargs))

    source = create_engine(owner_engine.url.set(drivername="postgresql+psycopg"))
    try:
        args, kwargs = source.dialect.create_connect_args(source.url)
    finally:
        source.dispose()
    engine = create_engine(
        "postgresql+psycopg://", creator=lambda: TracedConnection.connect(*args, **kwargs),
        pool_size=1, max_overflow=0, pool_pre_ping=True, skip_autocommit_rollback=True,
    )
    monkeypatch.setattr(db, "privileged_engine", engine)
    monkeypatch.setattr(db.sys, "platform", "linux")
    checkins = []

    def checked_in(connection, _record):
        if connection is not None:
            checkins.append(connection.autocommit)

    event.listen(engine, "checkin", checked_in)
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TEMP TABLE public_asset_transport_probe (value integer)"))
        commands.clear()
        with Session(engine) as session:
            assert session.execute(text("SELECT 123")).scalar_one() == 123
        assert commands == ["BEGIN", "ROLLBACK"]
        commands.clear()
        with Session(engine) as session:
            db.prepare_public_asset_read(session)
            assert session.execute(text("SELECT 123")).scalar_one() == 123
        assert commands == []
        assert checkins[-1] is False
        commands.clear()
        with Session(engine) as session:
            session.execute(text("INSERT INTO public_asset_transport_probe VALUES (123)"))
        assert commands == ["BEGIN", "ROLLBACK"]
        with Session(engine) as session:
            assert session.execute(text("SELECT count(*) FROM public_asset_transport_probe")).scalar_one() == 0
        assert all(autocommit is False for autocommit in checkins)
    finally:
        engine.dispose()

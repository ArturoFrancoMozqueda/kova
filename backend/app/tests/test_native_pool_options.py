"""Only native psycopg shared transaction poolers disable preparation."""

import pytest
from sqlalchemy.pool import NullPool

from app import db
from app.config import Settings, settings


@pytest.mark.parametrize("seconds", [0, -1, 31])
def test_connection_timeout_cannot_be_disabled_or_exceed_operational_budget(seconds):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_connect_timeout_seconds=seconds)


@pytest.mark.parametrize("privileged", [False, True])
def test_native_projected_recycle_setting_preserves_connection_caps_and_ping(monkeypatch, privileged):
    monkeypatch.setenv("DATABASE_POOL_RECYCLE_SECONDS", "1800")
    monkeypatch.setenv("DATABASE_POOL_SIZE", "3")
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "0")
    projected = Settings(_env_file=None)
    monkeypatch.setattr(db, "settings", projected)
    monkeypatch.setattr(db.sys, "platform", "linux")

    options = db._pool_options(privileged=privileged)
    assert projected.database_pool_recycle_seconds == 1800
    assert options["pool_recycle"] == 1800
    assert options["pool_size"] == (2 if privileged else 3)
    assert options["max_overflow"] == (2 if privileged else 0)
    assert db.engine.pool._pre_ping is True
    assert db.privileged_engine.pool._pre_ping is True
    assert Settings.model_fields["database_pool_recycle_seconds"].default == 300


@pytest.mark.parametrize("privileged", [False, True])
def test_native_supavisor_transaction_pooler_disables_prepared_statements(monkeypatch, privileged):
    monkeypatch.setattr(db.sys, "platform", "darwin")
    url = "postgresql+psycopg://synthetic:synthetic@aws-0-example.pooler.supabase.com:6543/postgres?sslmode=require"
    monkeypatch.setattr(settings, "app_database_url", url)
    monkeypatch.setattr(settings, "migration_database_url", url)
    options = db._pool_options(privileged=privileged)
    assert options["connect_args"] == {
        "connect_timeout": settings.database_connect_timeout_seconds,
        "prepare_threshold": None,
    }
    assert options["pool_size"] == (2 if privileged else settings.database_pool_size)
    assert options["max_overflow"] == (2 if privileged else settings.database_max_overflow)
    assert options["pool_timeout"] == settings.database_pool_timeout
    assert options["pool_recycle"] == settings.database_pool_recycle_seconds


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://synthetic@aws-0-example.pooler.supabase.com:5432/postgres",
    "postgresql+psycopg://synthetic@db.synthetic.supabase.co:5432/postgres",
    "postgresql+psycopg://synthetic@127.0.0.1:6543/postgres",
    "postgresql+psycopg://synthetic@aws-0-example.pooler.supabase.com.example:6543/postgres",
    "postgresql+pg8000://synthetic@aws-0-example.pooler.supabase.com:6543/postgres",
])
def test_native_other_transports_keep_existing_pool_options(monkeypatch, url):
    monkeypatch.setattr(db.sys, "platform", "darwin")
    monkeypatch.setattr(settings, "app_database_url", url)
    options = db._pool_options()
    if "postgresql+pg8000" in url:
        assert "connect_args" not in options
    else:
        assert options["connect_args"] == {
            "connect_timeout": settings.database_connect_timeout_seconds,
        }
    assert "creator" not in options
    assert options["pool_size"] == settings.database_pool_size


def test_native_pool_options_use_each_engines_own_connection(monkeypatch):
    monkeypatch.setattr(db.sys, "platform", "darwin")
    monkeypatch.setattr(settings, "app_database_url", "postgresql://synthetic@aws-0-example.pooler.supabase.com:6543/postgres")
    monkeypatch.setattr(settings, "migration_database_url", "postgresql://synthetic@db.synthetic.supabase.co:5432/postgres")
    assert db._pool_options()["connect_args"] == {
        "connect_timeout": settings.database_connect_timeout_seconds,
        "prepare_threshold": None,
    }
    assert db._pool_options(privileged=True)["connect_args"] == {
        "connect_timeout": settings.database_connect_timeout_seconds,
    }


def test_workers_hyperdrive_pool_options_are_unchanged(monkeypatch):
    monkeypatch.setattr(db.sys, "platform", "emscripten")
    options = db._pool_options()
    assert options["poolclass"] is NullPool
    assert callable(options["creator"])
    assert "connect_args" not in options
    assert "pool_size" not in options
    assert "pool_recycle" not in options
    assert "skip_autocommit_rollback" not in options


@pytest.mark.parametrize("driver,privileged,expected", [
    ("psycopg", True, True),
    ("psycopg", False, False),
    ("pg8000", True, False),
])
def test_skip_autocommit_rollback_is_scoped_to_native_privileged_psycopg(
    monkeypatch, driver, privileged, expected,
):
    monkeypatch.setattr(db.sys, "platform", "linux")
    monkeypatch.setattr(settings, "app_database_url", f"postgresql+{driver}://synthetic@127.0.0.1/test")
    monkeypatch.setattr(settings, "migration_database_url", f"postgresql+{driver}://synthetic@127.0.0.1/test")
    assert db._pool_options(privileged=privileged).get("skip_autocommit_rollback", False) is expected


def test_native_connection_timeout_releases_pool_slot_when_peer_never_answers(monkeypatch):
    """A real TCP peer accepts the connection but never completes PostgreSQL startup."""
    import socket
    import threading
    import time

    from sqlalchemy import create_engine
    from sqlalchemy.exc import OperationalError

    stop = threading.Event()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.settimeout(5)
        port = listener.getsockname()[1]

        def silent_peer():
            connection, _ = listener.accept()
            with connection:
                stop.wait(8)

        thread = threading.Thread(target=silent_peer, daemon=True)
        thread.start()
        url = f"postgresql+psycopg://synthetic@127.0.0.1:{port}/synthetic"
        monkeypatch.setattr(db.sys, "platform", "linux")
        monkeypatch.setattr(settings, "app_database_url", url)
        monkeypatch.setattr(settings, "database_connect_timeout_seconds", 2)
        engine = create_engine(url, hide_parameters=True, **db._pool_options())
        try:
            started = time.monotonic()
            with pytest.raises(OperationalError):
                engine.connect()
            assert 1.5 <= time.monotonic() - started < 6
            assert engine.pool.checkedout() == 0
        finally:
            stop.set()
            thread.join(timeout=5)
            engine.dispose()
        assert not thread.is_alive()

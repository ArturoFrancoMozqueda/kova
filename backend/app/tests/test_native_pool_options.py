"""Only native psycopg shared transaction poolers disable preparation."""

import pytest
from sqlalchemy.pool import NullPool

from app import db
from app.config import settings


@pytest.mark.parametrize("privileged", [False, True])
def test_native_supavisor_transaction_pooler_disables_prepared_statements(monkeypatch, privileged):
    monkeypatch.setattr(db.sys, "platform", "darwin")
    url = "postgresql+psycopg://synthetic:synthetic@aws-0-example.pooler.supabase.com:6543/postgres?sslmode=require"
    monkeypatch.setattr(settings, "app_database_url", url)
    monkeypatch.setattr(settings, "migration_database_url", url)
    options = db._pool_options(privileged=privileged)
    assert options["connect_args"] == {"prepare_threshold": None}
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
    assert "connect_args" not in options
    assert "creator" not in options
    assert options["pool_size"] == settings.database_pool_size


def test_native_pool_options_use_each_engines_own_connection(monkeypatch):
    monkeypatch.setattr(db.sys, "platform", "darwin")
    monkeypatch.setattr(settings, "app_database_url", "postgresql://synthetic@aws-0-example.pooler.supabase.com:6543/postgres")
    monkeypatch.setattr(settings, "migration_database_url", "postgresql://synthetic@db.synthetic.supabase.co:5432/postgres")
    assert db._pool_options()["connect_args"] == {"prepare_threshold": None}
    assert "connect_args" not in db._pool_options(privileged=True)


def test_workers_hyperdrive_pool_options_are_unchanged(monkeypatch):
    monkeypatch.setattr(db.sys, "platform", "emscripten")
    options = db._pool_options()
    assert options["poolclass"] is NullPool
    assert callable(options["creator"])
    assert "connect_args" not in options
    assert "pool_size" not in options

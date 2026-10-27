"""Repository-wide pytest setup that must run before any app module import."""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def pytest_configure(config) -> None:
    """Prepare the cluster role once, before the controller starts workers."""
    if os.environ.get("PYTEST_XDIST_WORKER") or not config.getoption("numprocesses", default=None):
        return
    raw = os.environ.get("DATABASE_URL", "postgresql+psycopg://pos:pos@localhost:5432/pos")
    url = make_url(raw)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text("SELECT pg_advisory_lock(7310402)"))
            try:
                conn.execute(text(
                    "DO $$ BEGIN "
                    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN "
                    "CREATE ROLE kova_app; END IF; END $$;"
                ))
                # This is a test-only credential/profile, never a production role.
                # Worker databases share the role, so workers must not ALTER it.
                conn.execute(text(
                    "ALTER ROLE kova_app WITH LOGIN PASSWORD 'kova_app' "
                    "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
                ))
            finally:
                conn.execute(text("SELECT pg_advisory_unlock(7310402)"))
    finally:
        admin.dispose()


def _isolate_xdist_worker_database() -> None:
    """Point each pytest-xdist worker at its own fresh database.

    pytest loads this root conftest before app/tests/conftest.py imports
    app.config, so Settings, the app engines and the
    alembic subprocess all see the worker URL. Cluster-wide roles are shared by
    every database, so `kova_app` is created here once under an advisory lock;
    tests that create or drop other roles share one xdist group instead.
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return
    raw = os.environ.get("DATABASE_URL", "postgresql+psycopg://pos:pos@localhost:5432/pos")
    url = make_url(raw)
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    name = f"{url.database}_{worker}"
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text("SELECT pg_advisory_lock(7310402)"))
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            conn.execute(text(f'CREATE DATABASE "{name}"'))
            conn.execute(
                text(
                    "DO $$ BEGIN "
                    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN "
                    "CREATE ROLE kova_app LOGIN PASSWORD 'kova_app' NOSUPERUSER NOBYPASSRLS "
                    "NOCREATEDB NOCREATEROLE; END IF; END $$;"
                )
            )
            conn.execute(text("SELECT pg_advisory_unlock(7310402)"))
    finally:
        admin.dispose()
    for key in ("DATABASE_URL", "APP_DATABASE_URL", "MIGRATION_DATABASE_URL"):
        if os.environ.get(key):
            os.environ[key] = make_url(os.environ[key]).set(database=name).render_as_string(
                hide_password=False
            )
    os.environ.setdefault("DATABASE_URL", url.set(database=name).render_as_string(
        hide_password=False
    ))


_isolate_xdist_worker_database()

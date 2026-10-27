"""Test-only provisioning for a role shared by all xdist worker databases."""

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

KOVA_APP_TEST_PASSWORD = "kova_app"
ROLE_PROVISION_LOCK = 7310403


def provision_test_runtime_role(database_url: str) -> None:
    """Serialize shared catalog writes from every worker on the same database.

    PostgreSQL advisory locks belong to a database. Taking the same lock in
    isolated worker databases does not coordinate their shared pg_authid row.
    Use the maintenance database for both this lock and the role DDL; grants on
    worker-owned tables remain in each worker's database.
    """
    url = make_url(database_url).set(database="postgres")
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.begin() as connection:
            connection.execute(text("SET LOCAL lock_timeout = '30s'"))
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"),
                               {"key": ROLE_PROVISION_LOCK})
            connection.execute(text(
                "DO $$ BEGIN "
                "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN "
                "CREATE ROLE kova_app LOGIN NOSUPERUSER NOBYPASSRLS "
                "NOCREATEDB NOCREATEROLE; END IF; END $$;"
            ))
            connection.execute(text(
                "ALTER ROLE kova_app WITH LOGIN PASSWORD 'kova_app' "
                "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
            ))
    finally:
        engine.dispose()

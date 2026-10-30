"""Exercise the additive grant column and safe downgrade against real PostgreSQL."""

import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def test_grant_defaults_false_and_downgrade_preserves_active_grants():
    url = os.environ.get("DATABASE_URL", "postgresql+psycopg://pos:pos@localhost:5432/pos")
    assert make_url(url).host in {"localhost", "127.0.0.1"}, (
        "Migration test requires local PostgreSQL"
    )
    path = Path(__file__).parents[1] / "alembic/versions/0099_complimentary_access.py"
    spec = importlib.util.spec_from_file_location("complimentary_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(url)
    schema = "courtesy_" + uuid4().hex
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(
                text("CREATE TABLE subscriptions (id integer PRIMARY KEY, status text NOT NULL)")
            )
            conn.execute(text("INSERT INTO subscriptions VALUES (1, 'incomplete')"))
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                assert (
                    conn.execute(
                        text("SELECT complimentary_access FROM subscriptions")
                    ).scalar_one()
                    is False
                )
                conn.execute(text("UPDATE subscriptions SET complimentary_access=true WHERE id=1"))
                with pytest.raises(Exception, match="Revoke complimentary grants"):
                    with conn.begin_nested():
                        migration.downgrade()
                assert (
                    conn.execute(
                        text("SELECT complimentary_access FROM subscriptions")
                    ).scalar_one()
                    is True
                )
                conn.execute(text("UPDATE subscriptions SET complimentary_access=false WHERE id=1"))
                migration.downgrade()
                migration.upgrade()
                assert (
                    conn.execute(
                        text("SELECT complimentary_access FROM subscriptions")
                    ).scalar_one()
                    is False
                )
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    finally:
        engine.dispose()

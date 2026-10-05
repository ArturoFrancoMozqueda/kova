"""Backfill, compatibility and data-loss protection for multi-location migration."""

import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import settings

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def _database():
    name = f"kova_branches_migration_{uuid4().hex}"
    base = make_url(settings.effective_migration_database_url)
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = base.set(database=name).render_as_string(hide_password=False)
    engine = create_engine(url)
    try:
        yield url, engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :name"
                ),
                {"name": name},
            )
            conn.execute(text(f'DROP DATABASE "{name}"'))
        admin.dispose()


def _migrate(url, command, revision):
    env = {**os.environ, "DATABASE_URL": url, "MIGRATION_DATABASE_URL": url, "APP_ENV": "local"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", command, revision],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    # Migration stderr has no connection parameters; never include the URL in assertions.
    return result


def test_populated_branch_migration_and_guarded_downgrade():
    with _database() as (url, engine):
        assert _migrate(url, "upgrade", "0067_runtime_grant_matrix").returncode == 0
        tenant, product, sale = uuid4(), uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Existing', :slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO products (id, tenant_id, name, price_amount) "
                    "VALUES (:id, :tenant, 'Pan', 10)"
                ),
                {"id": product, "tenant": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO orders (id, tenant_id, status, subtotal_amount, total_amount) "
                    "VALUES (:id, :tenant, 'completed', 20, 20)"
                ),
                {"id": sale, "tenant": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO inventory_movements "
                    "(id, tenant_id, product_id, order_id, movement_type, quantity_delta) "
                    "VALUES (:id, :tenant, :product, :order, 'sale', -2)"
                ),
                {"id": uuid4(), "tenant": tenant, "product": product, "order": sale},
            )
        applied = _migrate(url, "upgrade", "head")
        assert applied.returncode == 0, applied.stderr
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT branch_id, total_amount FROM orders WHERE id = :id"), {"id": sale}
            ).one()
            assert row.branch_id == tenant and row.total_amount == 20
            assert (
                conn.execute(
                    text("SELECT branch_id FROM inventory_movements WHERE order_id = :id"),
                    {"id": sale},
                ).scalar_one()
                == tenant
            )
            # Old backend INSERTs omit branch_id and must remain principal-compatible.
            conn.execute(
                text(
                    "INSERT INTO orders (id, tenant_id, status, subtotal_amount, total_amount) "
                    "VALUES (:id, :tenant, 'completed', 10, 10)"
                ),
                {"id": uuid4(), "tenant": tenant},
            )
        rolled = _migrate(url, "downgrade", "0067_runtime_grant_matrix")
        assert rolled.returncode == 0, rolled.stderr
        assert _migrate(url, "upgrade", "head").returncode == 0
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO branches (id, tenant_id, name) VALUES (:id, :tenant, 'Centro')"),
                {"id": uuid4(), "tenant": tenant},
            )
        blocked = _migrate(url, "downgrade", "0067_runtime_grant_matrix")
        assert blocked.returncode != 0
        assert "Cannot downgrade multi-location data" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT COUNT(*) FROM branches WHERE tenant_id = :tenant"),
                    {"tenant": tenant},
                ).scalar_one()
                == 2
            )
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                == "0068_branches"
            )

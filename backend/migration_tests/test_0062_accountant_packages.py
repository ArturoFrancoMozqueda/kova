"""Integration coverage for populated fiscal upgrades and runtime lock grants."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
TENANT_ID = uuid.UUID("11111111-1111-1111-1111-111111111162")
BATCH_ID = uuid.UUID("22222222-2222-2222-2222-222222222162")

FISCAL_TABLES = (
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "fiscal_global_draft_settings",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
    "fiscal_individual_invoice_events",
    "fiscal_global_draft_adjustments",
)
IMMUTABLE_TABLES = tuple(
    table for table in FISCAL_TABLES if table != "fiscal_global_draft_settings"
)


def _database_url() -> URL:
    configured = (
        os.environ.get("MIGRATION_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or "postgresql+psycopg://pos:pos@localhost:5432/pos"
    )
    return make_url(configured)


def _render(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _run_alembic(database_url: URL, revision: str, *, succeeds: bool = True) -> None:
    env = os.environ.copy()
    rendered_url = _render(database_url)
    env.update(
        {
            "APP_ENV": "ci",
            "DATABASE_URL": rendered_url,
            "APP_DATABASE_URL": rendered_url,
            "MIGRATION_DATABASE_URL": rendered_url,
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if succeeds:
        assert result.returncode == 0, result.stderr[-4000:]
    else:
        assert result.returncode != 0
        assert "forced fiscal migration failure" in result.stderr


def _assert_batch_is_immutable(engine) -> None:
    with engine.connect() as conn:
        transaction = conn.begin()
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "UPDATE fiscal_global_draft_batches "
                    "SET net_total_amount = net_total_amount WHERE id = :batch_id"
                ),
                {"batch_id": BATCH_ID},
            )
        transaction.rollback()
    assert exc.value.orig.sqlstate == "55000"


def _seed_0061_history(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, slug) "
                "VALUES (:tenant_id, 'Fiscal migration tenant', :slug)"
            ),
            {"tenant_id": TENANT_ID, "slug": f"fiscal-migration-{TENANT_ID}"},
        )
        conn.execute(
            text(
                "INSERT INTO fiscal_global_draft_batches "
                "(id, tenant_id, frequency, period_start, period_end, timezone, "
                "status, document_kind, fiscal_status, gross_amount, "
                "discount_total_amount, tax_total_amount, total_amount, "
                "refund_total_amount, net_total_amount, order_count, "
                "excluded_individually_confirmed_count, closed_at, created_at) "
                "VALUES (:batch_id, :tenant_id, 'daily', DATE '2026-08-01', "
                "DATE '2026-08-01', 'America/Mexico_City', 'closed', "
                "'operational_draft', 'not_issued', 100.00, 0.00, 0.00, "
                "100.00, 30.00, 70.00, 1, 0, now(), now())"
            ),
            {"batch_id": BATCH_ID, "tenant_id": TENANT_ID},
        )


def _install_forced_failure(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE FUNCTION force_fiscal_migration_failure() RETURNS trigger "
                "LANGUAGE plpgsql AS $$ BEGIN "
                "RAISE EXCEPTION 'forced fiscal migration failure'; END $$"
            )
        )
        conn.execute(
            text(
                "CREATE TRIGGER zzz_force_fiscal_migration_failure "
                "BEFORE UPDATE ON fiscal_global_draft_batches FOR EACH ROW "
                "EXECUTE FUNCTION force_fiscal_migration_failure()"
            )
        )


def _remove_forced_failure(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "DROP TRIGGER zzz_force_fiscal_migration_failure "
                "ON fiscal_global_draft_batches"
            )
        )
        conn.execute(text("DROP FUNCTION force_fiscal_migration_failure()"))


def _assert_failed_upgrade_rolled_back(engine) -> None:
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == (
            "0061_ops_founder_mfa"
        )
        assert not conn.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' "
                "AND table_name = 'fiscal_global_draft_batches' "
                "AND column_name = 'adjusted_net_amount')"
            )
        )
        assert conn.scalar(
            text(
                "SELECT tgenabled = 'O' FROM pg_trigger "
                "WHERE tgname = 'trg_fiscal_global_draft_batches_immutable'"
            )
        )
    _assert_batch_is_immutable(engine)


def _simulate_pre_hardening_grants(engine) -> None:
    tables = ", ".join(FISCAL_TABLES)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {tables} TO kova_app"
            )
        )


def _assert_hardened_grants_and_runtime_locks(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("GRANT USAGE ON SCHEMA public TO kova_app"))
        for table in FISCAL_TABLES:
            assert conn.scalar(
                text("SELECT has_table_privilege('kova_app', :table, 'SELECT')"),
                {"table": table},
            )
            assert conn.scalar(
                text("SELECT has_table_privilege('kova_app', :table, 'INSERT')"),
                {"table": table},
            )
            assert not conn.scalar(
                text("SELECT has_table_privilege('kova_app', :table, 'DELETE')"),
                {"table": table},
            )
        for table in IMMUTABLE_TABLES:
            assert not conn.scalar(
                text("SELECT has_table_privilege('kova_app', :table, 'UPDATE')"),
                {"table": table},
            )
        assert conn.scalar(
            text(
                "SELECT has_table_privilege("
                "'kova_app', 'fiscal_global_draft_settings', 'UPDATE')"
            )
        )
        for table in ("order_fiscal_snapshots", "fiscal_global_draft_batches"):
            assert conn.scalar(
                text(
                    "SELECT has_column_privilege("
                    "'kova_app', :table, 'id', 'UPDATE')"
                ),
                {"table": table},
            )

    with engine.begin() as conn:
        conn.execute(text("SET LOCAL ROLE kova_app"))
        conn.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(TENANT_ID)},
        )
        assert conn.scalar(
            text(
                "SELECT id FROM fiscal_global_draft_batches "
                "WHERE id = :batch_id FOR UPDATE"
            ),
            {"batch_id": BATCH_ID},
        ) == BATCH_ID
        conn.execute(
            text(
                "SELECT * FROM order_fiscal_snapshots "
                "WHERE tenant_id = :tenant_id FOR UPDATE"
            ),
            {"tenant_id": TENANT_ID},
        ).all()

    with engine.connect() as conn:
        transaction = conn.begin()
        conn.execute(text("SET LOCAL ROLE kova_app"))
        conn.execute(
            text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
            {"tenant_id": str(TENANT_ID)},
        )
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "UPDATE fiscal_global_draft_batches SET id = id "
                    "WHERE id = :batch_id"
                ),
                {"batch_id": BATCH_ID},
            )
        transaction.rollback()
    assert exc.value.orig.sqlstate == "55000"


def test_populated_upgrade_rolls_back_safely_and_reconciles_runtime_grants() -> None:
    admin_url = _database_url()
    database_name = f"kova_fiscal_{uuid.uuid4().hex}"
    test_url = admin_url.set(database=database_name)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    test_engine = None
    role_created = False

    try:
        with admin_engine.connect() as conn:
            role_created = not conn.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app')")
            )
            if role_created:
                conn.execute(
                    text(
                        "CREATE ROLE kova_app NOLOGIN NOSUPERUSER NOBYPASSRLS "
                        "NOCREATEDB NOCREATEROLE"
                    )
                )
            conn.execute(text(f'CREATE DATABASE "{database_name}"'))

        _run_alembic(test_url, "0061_ops_founder_mfa")
        test_engine = create_engine(test_url)
        _seed_0061_history(test_engine)
        _assert_batch_is_immutable(test_engine)

        _install_forced_failure(test_engine)
        _run_alembic(test_url, "0062_accountant_packages", succeeds=False)
        _assert_failed_upgrade_rolled_back(test_engine)
        _remove_forced_failure(test_engine)

        _run_alembic(test_url, "0062_accountant_packages")
        with test_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT net_total_amount, adjusted_net_amount, "
                    "adjustment_total_amount, adjustment_count "
                    "FROM fiscal_global_draft_batches WHERE id = :batch_id"
                ),
                {"batch_id": BATCH_ID},
            ).one()
            assert tuple(row) == (70, 70, 0, 0)
            assert conn.scalar(
                text(
                    "SELECT tgenabled = 'O' FROM pg_trigger "
                    "WHERE tgname = 'trg_fiscal_global_draft_batches_immutable'"
                )
            )
        _assert_batch_is_immutable(test_engine)

        _simulate_pre_hardening_grants(test_engine)
        _run_alembic(test_url, "head")
        _assert_hardened_grants_and_runtime_locks(test_engine)
    finally:
        if test_engine is not None:
            test_engine.dispose()
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
            if role_created:
                conn.execute(text("DROP ROLE IF EXISTS kova_app"))
        admin_engine.dispose()

"""Agenda upgrades preserve existing sales and reject destructive history loss."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import _temporary_database
from migration_tests.test_0068_branches import _database, _migrate

TABLES = ("appointment_resources", "appointments", "appointment_history", "appointment_reminders")


def test_appointment_upgrade_preserves_existing_sale_and_enforces_private_rls():
    # Provision test-only runtime/Data API roles even on a fresh CI cluster;
    # the helper restores roles it created after removing its disposable DB.
    with _temporary_database() as (database_url, engine):
        url = database_url.render_as_string(hide_password=False)
        baseline = _migrate(url, "upgrade", "0087_quote_opportunity_link")
        assert baseline.returncode == 0, baseline.stderr
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Agenda migration',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:id,:tenant,'completed',125.50,125.50)"
                ),
                {"id": sale, "tenant": tenant},
            )
        applied = _migrate(url, "upgrade", "0088_appointments")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("125.50")
            for table in TABLES:
                flags = connection.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                        "WHERE relname=:table"
                    ),
                    {"table": table},
                ).one()
                assert tuple(flags) == (True, True)
                for role in ("anon", "authenticated", "service_role"):
                    assert not connection.scalar(
                        text("SELECT has_table_privilege(:role,:table,'SELECT')"),
                        {"role": role, "table": table},
                    )
                assert not connection.scalar(
                    text("SELECT has_table_privilege('kova_app',:table,'DELETE')"), {"table": table}
                )
            assert not connection.scalar(
                text(
                    "SELECT has_column_privilege('kova_app','appointment_resources',"
                    "'timezone','UPDATE')"
                )
            )
            assert not connection.scalar(
                text("SELECT has_table_privilege('kova_app','appointment_history','UPDATE')")
            )


def test_empty_appointment_downgrade_reverses_and_real_resource_blocks_history_loss():
    with _database() as (url, engine):
        applied = _migrate(url, "upgrade", "0088_appointments")
        assert applied.returncode == 0, applied.stderr
        rolled = _migrate(url, "downgrade", "0087_quote_opportunity_link")
        assert rolled.returncode == 0, rolled.stderr
        applied = _migrate(url, "upgrade", "0088_appointments")
        assert applied.returncode == 0, applied.stderr
        tenant, resource = uuid4(), uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Agenda migration',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text(
                    "INSERT INTO appointment_resources(id,tenant_id,branch_id,name,timezone,"
                    "is_active,version,created_at,updated_at) VALUES(:id,:tenant,:tenant,"
                    "'Recurso real','America/Mexico_City',true,1,now(),now())"
                ),
                {"id": resource, "tenant": tenant},
            )
        blocked = _migrate(url, "downgrade", "0087_quote_opportunity_link")
        assert blocked.returncode != 0
        assert "Preserve internal agenda history" in blocked.stderr
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text("SELECT count(*) FROM appointment_resources WHERE id=:id"),
                    {"id": resource},
                )
                == 1
            )

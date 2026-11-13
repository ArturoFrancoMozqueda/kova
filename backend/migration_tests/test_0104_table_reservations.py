from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import (
    _run_alembic,
    _run_provision,
    _temporary_database,
)
from migration_tests.test_0068_branches import _migrate


def test_table_upgrade_preserves_existing_resources_and_round_trips_empty():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0103_booking_and_loyalty_design")
        tenant = uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Existing appointments',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO appointment_resources(id,tenant_id,branch_id,name,timezone,"
                    "is_active,version,created_at,updated_at) "
                    "VALUES(:id,:id,:id,'Ana','America/Mexico_City',true,1,now(),now())"
                ),
                {"id": tenant},
            )
        _run_alembic(url, "0104_table_reservation_requests")
        _run_provision(url)
        with engine.begin() as conn:
            assert (
                conn.scalar(
                    text("SELECT kind FROM appointment_resources WHERE id=:id"), {"id": tenant}
                )
                == "appointment"
            )
            for table in ("table_reservations", "table_reservation_history"):
                assert conn.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity "
                        "FROM pg_class WHERE relname=:table"
                    ),
                    {"table": table},
                ).one() == (True, True)
                for role in ("anon", "authenticated", "service_role"):
                    assert not conn.scalar(
                        text("SELECT has_table_privilege(:role,:table,'SELECT')"),
                        {"role": role, "table": table},
                    )
                assert conn.scalar(
                    text("SELECT has_table_privilege('kova_app',:table,'SELECT')"),
                    {"table": table},
                )
            assert not conn.scalar(
                text(
                    "SELECT has_column_privilege('kova_app',"
                    "'appointment_resources','kind','UPDATE')"
                )
            )
        rendered = url.render_as_string(hide_password=False)
        rollback = _migrate(rendered, "downgrade", "0103_booking_and_loyalty_design")
        assert rollback.returncode == 0, rollback.stderr
        _run_alembic(url, "0104_table_reservation_requests")


def test_populated_table_configuration_cannot_be_discarded():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0104_table_reservation_requests")
        tenant = uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Tables',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO appointment_resources(id,tenant_id,branch_id,name,timezone,kind,"
                    "is_active,version,created_at,updated_at) "
                    "VALUES(:id,:id,:id,'Mesa 1','America/Mexico_City','table',true,1,now(),now())"
                ),
                {"id": tenant},
            )
        rollback = _migrate(
            url.render_as_string(hide_password=False),
            "downgrade",
            "0103_booking_and_loyalty_design",
        )
        assert rollback.returncode != 0 and "Cannot discard table reservation" in rollback.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text("SELECT kind FROM appointment_resources WHERE id=:id"), {"id": tenant}
                )
                == "table"
            )

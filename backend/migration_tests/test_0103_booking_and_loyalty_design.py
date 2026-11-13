from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate

TABLES = (
    "booking_pages",
    "booking_services",
    "booking_service_resources",
    "booking_availability",
    "public_bookings",
    "booking_history",
    "loyalty_appearances",
)


def test_booking_upgrade_empty_downgrade_preserves_forced_rls_and_private_grants():
    with _database() as (url, engine):
        result = _migrate(url, "upgrade", "0103_booking_and_loyalty_design")
        assert result.returncode == 0, result.stderr
        with engine.connect() as conn:
            for table in TABLES:
                assert conn.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity "
                        "FROM pg_class WHERE relname=:name"
                    ),
                    {"name": table},
                ).one() == (True, True)
                assert not conn.scalar(
                    text("SELECT has_table_privilege('public',:name,'SELECT')"), {"name": table}
                )
        result = _migrate(url, "downgrade", "0102_whatsapp_signup")
        assert result.returncode == 0, result.stderr
        assert _migrate(url, "upgrade", "0103_booking_and_loyalty_design").returncode == 0


def test_design_history_is_not_discarded_by_downgrade():
    from uuid import uuid4

    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0103_booking_and_loyalty_design")
        assert upgraded.returncode == 0, upgraded.stderr
        tenant = uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Diseño conservado',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO loyalty_appearances(id,tenant_id,branch_id,color,"
                    "use_business_logo,version) "
                    "VALUES(:id,:id,:id,'#0F1117',true,1)"
                ),
                {"id": tenant},
            )
        blocked = _migrate(url, "downgrade", "0102_whatsapp_signup")
        assert (
            blocked.returncode != 0
            and "Cannot discard scheduling or loyalty history" in blocked.stderr
        )
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text("SELECT version FROM loyalty_appearances WHERE tenant_id=:id"),
                    {"id": tenant},
                )
                == 1
            )

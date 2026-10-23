"""Private attribution is additive and cannot be downgraded away after use."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import _temporary_database
from migration_tests.test_0068_branches import _migrate


def test_appointment_sales_migration_preserves_sales_rls_grants_and_empty_roundtrip():
    with _temporary_database() as (database_url, engine):
        url = database_url.render_as_string(hide_password=False)
        assert _migrate(url, "upgrade", "0093_readable_catalog_links").returncode == 0
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Attribution',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:id,:tenant,'completed',125.50,125.50)"
                ),
                {"id": sale, "tenant": tenant},
            )
        applied = _migrate(url, "upgrade", "0094_appointment_sales")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("125.50")
            assert tuple(
                connection.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                        "WHERE relname='appointment_sales'"
                    )
                ).one()
            ) == (True, True)
            for role in ("anon", "authenticated", "service_role"):
                assert not connection.scalar(
                    text("SELECT has_table_privilege(:role,'appointment_sales','SELECT')"),
                    {"role": role},
                )
            for verb in ("UPDATE", "DELETE"):
                assert not connection.scalar(
                    text("SELECT has_table_privilege('kova_app','appointment_sales',:verb)"),
                    {"verb": verb},
                )
        rolled = _migrate(url, "downgrade", "0093_readable_catalog_links")
        assert rolled.returncode == 0, rolled.stderr
        assert _migrate(url, "upgrade", "0094_appointment_sales").returncode == 0
        actor, customer, resource, appointment = uuid4(), uuid4(), uuid4(), uuid4()
        with engine.begin() as connection:
            values = {
                "actor": actor,
                "tenant": tenant,
                "customer": customer,
                "resource": resource,
                "appointment": appointment,
                "sale": sale,
                "member": uuid4(),
                "link": uuid4(),
                "email": f"{actor}@example.com",
            }
            statements = (
                "INSERT INTO users(id,email,hashed_password,is_email_verified,"
                "is_active,created_at,updated_at) "
                "VALUES(:actor,:email,'test-only',true,true,now(),now())",
                "INSERT INTO memberships(id,tenant_id,user_id,role,is_active,created_at) "
                "VALUES(:member,:tenant,:actor,'owner',true,now())",
                "INSERT INTO customers(id,tenant_id,name,is_active,created_at,updated_at) "
                "VALUES(:customer,:tenant,'Cliente real',true,now(),now())",
                "INSERT INTO appointment_resources(id,tenant_id,branch_id,name,timezone,"
                "is_active,version,created_at,updated_at) "
                "VALUES(:resource,:tenant,:tenant,'Atención','America/Mexico_City',true,1,now(),now())",
                "INSERT INTO appointments(id,tenant_id,branch_id,resource_id,customer_id,"
                "title,starts_at,ends_at,status,version,created_by_user_id,created_at,updated_at) "
                "VALUES(:appointment,:tenant,:tenant,:resource,:customer,'Servicio',"
                "now(),now()+interval '1 hour','completed',1,:actor,now(),now())",
                "INSERT INTO appointment_sales(id,tenant_id,branch_id,appointment_id,"
                "sale_order_id,actor_user_id,created_at) "
                "VALUES(:link,:tenant,:tenant,:appointment,:sale,:actor,now())",
            )
            for statement in statements:
                connection.execute(text(statement), values)
        blocked = _migrate(url, "downgrade", "0093_readable_catalog_links")
        assert blocked.returncode != 0
        assert "Cannot discard appointment sale attribution" in blocked.stderr

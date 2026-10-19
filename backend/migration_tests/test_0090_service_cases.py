"""Private attention workflows preserve operational data and immutable history."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate

RLS_FLAGS_SQL = "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:name"


def test_service_case_upgrade_preserves_sales_and_empty_downgrade_is_reversible():
    with _database() as (url, engine):
        before = _migrate(url, "upgrade", "0089_internal_loyalty")
        assert before.returncode == 0, before.stderr
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Attention migration',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO "
                    "orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:id,:tenant,'completed',123.45,123.45)"
                ),
                {"id": sale, "tenant": tenant},
            )
        upgraded = _migrate(url, "upgrade", "0090_service_cases")
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.connect() as conn:
            assert conn.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("123.45")
            for table in ("service_cases", "service_case_events"):
                assert tuple(conn.execute(text(RLS_FLAGS_SQL), {"name": table}).one()) == (
                    True,
                    True,
                )
        empty = _migrate(url, "downgrade", "0089_internal_loyalty")
        assert empty.returncode == 0, empty.stderr
        assert _migrate(url, "upgrade", "0090_service_cases").returncode == 0


def test_service_case_history_blocks_destructive_downgrade():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0090_service_cases")
        assert upgraded.returncode == 0, upgraded.stderr
        tenant, customer, case, event = [uuid4() for _ in range(4)]
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Attention history',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO "
                    "users(id,email,hashed_password,is_email_verified) "
                    "VALUES(:id,:email,'test-only',true)"
                ),
                {"id": tenant, "email": f"migration-{tenant}@example.com"},
            )
            conn.execute(
                text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
                {"id": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO "
                    "customers(id,tenant_id,name,is_active,created_at,updated_at)"
                    " VALUES(:id,:tenant,'Case customer',true,now(),now())"
                ),
                {"id": customer, "tenant": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO service_cases(id,tenant_id,branch_id,customer_id"
                    ",title,status,version,created_by_user_id,created_at,updated_"
                    "at) VALUES(:id,:tenant,:tenant,:customer,'Local "
                    "case','open',1,:tenant,now(),now())"
                ),
                {"id": case, "tenant": tenant, "customer": customer},
            )
            conn.execute(
                text(
                    "INSERT INTO service_case_events(id,tenant_id,branch_id,case_"
                    "id,case_version,kind,actor_user_id,status,note,created_at) V"
                    "ALUES(:id,:tenant,:tenant,:case,1,'created',:tenant,'open','"
                    "Original private note',now())"
                ),
                {"id": event, "tenant": tenant, "case": case},
            )
        blocked = _migrate(url, "downgrade", "0089_internal_loyalty")
        assert blocked.returncode != 0
        assert "Cannot discard service cases" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT count(*) FROM service_cases WHERE id=:id"), {"id": case})
                == 1
            )
            assert (
                conn.scalar(
                    text("SELECT note FROM service_case_events WHERE id=:id"), {"id": event}
                )
                == "Original private note"
            )

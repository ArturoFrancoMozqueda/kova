"""Loyalty revisions/ledger are private and cannot be discarded by downgrade."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate

RLS_FLAGS_SQL = "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:name"


def test_loyalty_upgrade_preserves_existing_sales_and_empty_downgrade_is_reversible():
    with _database() as (url, engine):
        before = _migrate(url, "upgrade", "0088_appointments")
        assert before.returncode == 0, before.stderr
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Loyalty migration',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:id,:tenant,'completed',123.45,123.45)"
                ),
                {"id": sale, "tenant": tenant},
            )
        upgraded = _migrate(url, "upgrade", "0089_internal_loyalty")
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.connect() as conn:
            assert conn.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("123.45")
            for table in ("loyalty_policy_revisions", "loyalty_entries"):
                flags = conn.execute(
                    text(RLS_FLAGS_SQL),
                    {"name": table},
                ).one()
                assert tuple(flags) == (True, True)
        downgraded = _migrate(url, "downgrade", "0088_appointments")
        assert downgraded.returncode == 0, downgraded.stderr
        assert _migrate(url, "upgrade", "0089_internal_loyalty").returncode == 0


def test_loyalty_history_guard_and_source_amounts_survive_failed_downgrade():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0089_internal_loyalty")
        assert upgraded.returncode == 0, upgraded.stderr
        tenant, customer, policy, sale, entry = [uuid4() for _ in range(5)]
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Loyalty history',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO users(id,email,hashed_password,is_email_verified) "
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
                    "INSERT INTO customers(id,tenant_id,name,is_active,created_at,updated_at) "
                    "VALUES(:id,:tenant,'Loyal customer',true,now(),now())"
                ),
                {"id": customer, "tenant": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO "
                    "orders(id,tenant_id,status,subtotal_amount,total_amount,customer_id) "
                    "VALUES(:id,:tenant,'completed',35,35,:customer)"
                ),
                {"id": sale, "tenant": tenant, "customer": customer},
            )
            conn.execute(
                text(
                    "INSERT INTO loyalty_policy_revisions(id,tenant_id,branch_id,version,enabled"
                    ",spend_amount,points_per_step,authorized_by_user_id,effective_at) "
                    "VALUES(:id,:tenant,:tenant,1,true,10,1,:tenant,now())"
                ),
                {"id": policy, "tenant": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO loyalty_entries(id,tenant_id,branch_id,customer_id,sale_order_i"
                    "d,policy_revision_id,kind,source_id,points,created_at) "
                    "VALUES(:id,:tenant,:tenant,:customer,:sale,:policy,'accrual',:sale,3,now())"
                ),
                {
                    "id": entry,
                    "tenant": tenant,
                    "customer": customer,
                    "sale": sale,
                    "policy": policy,
                },
            )
        blocked = _migrate(url, "downgrade", "0088_appointments")
        assert blocked.returncode != 0
        assert "Cannot discard loyalty" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT points FROM loyalty_entries WHERE id=:id"), {"id": entry})
                == 3
            )
            assert conn.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("35")
            assert (
                conn.scalar(
                    text("SELECT count(*) FROM loyalty_policy_revisions WHERE tenant_id=:id"),
                    {"id": tenant},
                )
                == 1
            )

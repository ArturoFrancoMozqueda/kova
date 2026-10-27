"""Adverse migration checks retain old points and new reward history."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_reward_migration_preserves_sales_and_empty_downgrade_restores_ledger_constraints():
    with _database() as (url, engine):
        assert _migrate(url, "upgrade", "0096_catalog_order_intake").returncode == 0
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Existing reward shop',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:id,:tenant,'completed',32.50,32.50)"
                ),
                {"id": sale, "tenant": tenant},
            )
        migrated = _migrate(url, "upgrade", "0097_loyalty_pos_rewards")
        assert migrated.returncode == 0, migrated.stderr
        with engine.connect() as conn:
            assert conn.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("32.50")
            for table in ("loyalty_reward_revisions", "loyalty_reward_redemptions"):
                assert conn.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity "
                        "FROM pg_class WHERE relname=:name"
                    ),
                    {"name": table},
                ).one() == (True, True)
        rolled_back = _migrate(url, "downgrade", "0096_catalog_order_intake")
        assert rolled_back.returncode == 0, rolled_back.stderr
        with engine.connect() as conn:
            source = conn.scalar(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conname='ck_loyalty_entry_kind'"
                )
            )
            assert "reward_return" not in source
        assert _migrate(url, "upgrade", "0097_loyalty_pos_rewards").returncode == 0


def test_nonempty_reward_history_cannot_be_discarded_and_old_money_stays_intact():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0097_loyalty_pos_rewards")
        assert upgraded.returncode == 0, upgraded.stderr
        tenant, revision = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Reward history',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                    "VALUES(:id,:email,'test-only',true)"
                ),
                {"id": tenant, "email": f"reward-{tenant}@example.com"},
            )
            conn.execute(
                text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
                {"id": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO loyalty_reward_revisions(id,tenant_id,branch_id,version,enabled,"
                    "title,points_cost,discount_amount,authorized_by_user_id,effective_at) "
                    "VALUES(:id,:tenant,:tenant,1,true,'Explicit reward',8,10,:tenant,now())"
                ),
                {"id": revision, "tenant": tenant},
            )
        blocked = _migrate(url, "downgrade", "0096_catalog_order_intake")
        assert blocked.returncode != 0
        assert "Cannot discard POS loyalty rewards history" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text("SELECT points_cost FROM loyalty_reward_revisions WHERE id=:id"),
                    {"id": revision},
                )
                == 8
            )

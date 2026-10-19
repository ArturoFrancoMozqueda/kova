"""The second commercial slice preserves history and every new table's RLS."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate

TABLES = (
    "messaging_channel_bindings",
    "messaging_conversations",
    "messaging_messages",
    "messaging_channel_events",
    "crm_catalog_requests",
    "crm_followup_policies",
    "crm_followup_tasks",
)


def test_upgrade_from_first_commercial_slice_preserves_sales_and_adds_private_workflows():
    with _database() as (url, engine):
        assert _migrate(url, "upgrade", "0084_customer_quotes").returncode == 0
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:t,'Local',:s)"),
                {"t": tenant, "s": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
                    "VALUES(:s,:t,'completed',123.45,123.45)"
                ),
                {"s": sale, "t": tenant},
            )
        upgraded = _migrate(url, "upgrade", "head")
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.connect() as conn:
            assert conn.scalar(
                text("SELECT total_amount FROM orders WHERE id=:s"), {"s": sale}
            ) == Decimal("123.45")
            for table in TABLES:
                assert tuple(
                    conn.execute(
                        text(
                            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                            "WHERE relname=:t"
                        ),
                        {"t": table},
                    ).one()
                ) == (True, True)
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM information_schema.columns "
                        "WHERE table_name='customer_quotes' "
                        "AND column_name='opportunity_id'"
                    )
                )
                == 1
            )


def test_empty_completion_downgrade_is_reversible_but_inbox_history_blocks_loss():
    with _database() as (url, engine):
        result = _migrate(url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        result = _migrate(url, "downgrade", "0084_customer_quotes")
        assert result.returncode == 0, result.stderr
        assert _migrate(url, "upgrade", "head").returncode == 0
        tenant, customer, conversation = uuid4(), uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:t,'Local',:s)"),
                {"t": tenant, "s": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO customers(id,tenant_id,name,is_active,created_at,updated_at)"
                    " VALUES(:c,:t,'Local',true,now(),now())"
                ),
                {"c": customer, "t": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO messaging_conversations(id,tenant_id,branch_id,customer_id,"
                    "subject,origin,status,automation_paused,version,created_at,updated_at) "
                    "VALUES(:i,:t,:t,:c,'Consulta','manual','open',true,1,now(),now())"
                ),
                {"i": conversation, "t": tenant, "c": customer},
            )
        blocked = _migrate(url, "downgrade", "0084_customer_quotes")
        assert blocked.returncode != 0
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM messaging_conversations")) == 1

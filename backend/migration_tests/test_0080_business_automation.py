"""E2E expansion upgrades preserve legacy sales and refuse publication data loss."""

from decimal import Decimal
from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate

TABLES = (
    "automation_rules",
    "business_events",
    "automation_runs",
    "crm_opportunities",
    "customer_contact_consents",
    "public_catalogs",
    "public_catalog_items",
    "reconciliation_import_batches",
    "settlement_entries",
    "reconciliation_matches",
    "customer_quotes",
    "customer_quote_items",
)


def test_populated_e2e_upgrade_preserves_sale_and_secures_every_new_table():
    with _database() as (url, engine):
        baseline = _migrate(url, "upgrade", "0079_lot_trigger_search_path")
        assert baseline.returncode == 0, baseline.stderr
        tenant, sale = uuid4(), uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Local',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,"
                    "total_amount) VALUES(:id,:tenant,'completed',100,100)"
                ),
                {"id": sale, "tenant": tenant},
            )
        applied = _migrate(url, "upgrade", "0084_customer_quotes")
        assert applied.returncode == 0, applied.stderr
        with engine.connect() as connection:
            assert connection.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": sale}
            ) == Decimal("100.00")
            for table in TABLES:
                assert tuple(
                    connection.execute(
                        text(
                            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                            "WHERE relname=:name"
                        ),
                        {"name": table},
                    ).one()
                ) == (True, True)
            assert (
                connection.scalar(
                    text(
                        "SELECT data_type FROM information_schema.columns "
                        "WHERE table_name='business_events' "
                        "AND column_name='entity_version'"
                    )
                )
                == "bigint"
            )


def test_empty_e2e_downgrade_reverses_but_publication_history_blocks_loss():
    with _database() as (url, engine):
        applied = _migrate(url, "upgrade", "0084_customer_quotes")
        assert applied.returncode == 0, applied.stderr
        rolled = _migrate(url, "downgrade", "0079_lot_trigger_search_path")
        assert rolled.returncode == 0, rolled.stderr
        applied = _migrate(url, "upgrade", "0084_customer_quotes")
        assert applied.returncode == 0, applied.stderr
        tenant = uuid4()
        with engine.begin() as connection:
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Local',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            connection.execute(
                text(
                    "INSERT INTO public_catalogs(id,tenant_id,branch_id,title,"
                    "enabled,version,link_version,updated_at) "
                    "VALUES(:id,:tenant,:tenant,'Catálogo',false,1,1,now())"
                ),
                {"id": uuid4(), "tenant": tenant},
            )
        blocked = _migrate(url, "downgrade", "0081_commercial_crm")
        assert blocked.returncode != 0
        assert "Cannot discard publication records" in blocked.stderr
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM public_catalogs")) == 1

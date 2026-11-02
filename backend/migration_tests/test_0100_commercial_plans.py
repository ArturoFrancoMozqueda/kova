"""Real PostgreSQL compatibility and history guards for the commercial foundation."""

from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from migration_tests.test_0068_branches import _database, _migrate

BASELINE = "0099_complimentary_access"
REVISION = "0100_commercial_plans"


def _old_tenant(conn, *, courtesy=False):
    tenant, subscription, sale = uuid4(), uuid4(), uuid4()
    # Omit every column introduced by 0100, just as the previous binary does.
    conn.execute(text(
        "INSERT INTO tenants(id,name,slug) VALUES(:id,'Existing plan shop',:slug)"
    ), {"id": tenant, "slug": str(tenant)})
    conn.execute(text(
        "INSERT INTO subscriptions(id,tenant_id,status,complimentary_access) "
        "VALUES(:id,:tenant,:status,:courtesy)"
    ), {"id": subscription, "tenant": tenant,
        "status": "incomplete" if courtesy else "active", "courtesy": courtesy})
    conn.execute(text(
        "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) "
        "VALUES(:id,:tenant,'completed',32.50,32.50)"
    ), {"id": sale, "tenant": tenant})
    return tenant, subscription, sale


def _security(conn):
    return conn.execute(text(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class "
        "WHERE relname IN ('tenants','subscriptions','orders') ORDER BY relname"
    )).all()


def _assert_legacy(conn, rows):
    for tenant, subscription, sale in rows:
        assert conn.execute(text(
            "SELECT billing_cohort FROM tenants WHERE id=:id"
        ), {"id": tenant}).scalar_one() == "standard"
        plan = conn.execute(text(
            "SELECT plan_code,plan_effective_until,amount_minor_units "
            "FROM subscriptions WHERE id=:id"
        ), {"id": subscription}).one()
        assert tuple(plan) == ("standard", None, 29900)
        order = conn.execute(text(
            "SELECT loyalty_eligible,total_amount FROM orders WHERE id=:id"
        ), {"id": sale}).one()
        assert tuple(order) == (True, Decimal("32.50"))


def test_existing_agreements_and_previous_binary_inserts_remain_standard_with_safe_round_trip():
    with _database() as (url, engine):
        baseline = _migrate(url, "upgrade", BASELINE)
        assert baseline.returncode == 0, baseline.stderr
        with engine.begin() as conn:
            existing = [_old_tenant(conn), _old_tenant(conn, courtesy=True)]
            security = _security(conn)
        upgraded = _migrate(url, "upgrade", REVISION)
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.begin() as conn:
            _assert_legacy(conn, existing)
            assert _security(conn) == security
            assert conn.execute(text(
                "SELECT complimentary_access FROM subscriptions WHERE id=:id"
            ), {"id": existing[1][1]}).scalar_one() is True
            previous_binary = _old_tenant(conn)
            _assert_legacy(conn, [previous_binary])
            for query, params in (
                ("UPDATE tenants SET billing_cohort='unrecognized' WHERE id=:id",
                 {"id": existing[0][0]}),
                ("UPDATE tenants SET billing_cohort=NULL WHERE id=:id",
                 {"id": existing[0][0]}),
                ("UPDATE subscriptions SET plan_code='unrecognized' WHERE id=:id",
                 {"id": existing[0][1]}),
                ("UPDATE subscriptions SET plan_code=NULL WHERE id=:id",
                 {"id": existing[0][1]}),
                ("UPDATE orders SET loyalty_eligible=NULL WHERE id=:id",
                 {"id": existing[0][2]}),
            ):
                with pytest.raises(IntegrityError), conn.begin_nested():
                    conn.execute(text(query), params)
        # No tiered/elegibility history exists; prior agreements and courtesy survive rollback.
        downgraded = _migrate(url, "downgrade", BASELINE)
        assert downgraded.returncode == 0, downgraded.stderr
        with engine.connect() as conn:
            assert conn.execute(text(
                "SELECT complimentary_access,amount_minor_units FROM subscriptions WHERE id=:id"
            ), {"id": existing[1][1]}).one() == (True, 29900)
            assert conn.execute(text(
                "SELECT total_amount FROM orders WHERE id=:id"
            ), {"id": existing[0][2]}).scalar_one() == Decimal("32.50")
            assert _security(conn) == security
            assert conn.execute(text(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' "
                "AND ((table_name='tenants' AND column_name='billing_cohort') "
                "OR (table_name='subscriptions' AND column_name IN "
                "('plan_code','plan_effective_until')) "
                "OR (table_name='orders' AND column_name='loyalty_eligible'))"
            )).scalar_one() == 0
        reapplied = _migrate(url, "upgrade", REVISION)
        assert reapplied.returncode == 0, reapplied.stderr
        with engine.connect() as conn:
            _assert_legacy(conn, [*existing, previous_binary])


def test_downgrade_refuses_to_discard_cohorts_entitlements_and_loyalty_ineligibility():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", REVISION)
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.begin() as conn:
            tenant, subscription, sale = _old_tenant(conn)
        protected = (
            ("UPDATE tenants SET billing_cohort='tiered' WHERE id=:id", tenant,
             "Resolve commercial plan agreements", "tenants", "billing_cohort", "tiered",
             "UPDATE tenants SET billing_cohort='standard' WHERE id=:id"),
            ("UPDATE subscriptions SET plan_code='gestion' WHERE id=:id", subscription,
             "Resolve commercial plan agreements", "subscriptions", "plan_code", "gestion",
             "UPDATE subscriptions SET plan_code='standard' WHERE id=:id"),
            ("UPDATE orders SET loyalty_eligible=false WHERE id=:id", sale,
             "Preserve loyalty eligibility history", "orders", "loyalty_eligible", False,
             "UPDATE orders SET loyalty_eligible=true WHERE id=:id"),
        )
        for change, identifier, reason, table, column, value, restore in protected:
            with engine.begin() as conn:
                conn.execute(text(change), {"id": identifier})
            refused = _migrate(url, "downgrade", BASELINE)
            assert refused.returncode != 0
            assert reason in refused.stderr
            with engine.begin() as conn:
                # Identifiers are fixed test constants above, never tenant/client input.
                assert conn.execute(text(
                    f"SELECT {column} FROM {table} WHERE id=:id"
                ), {"id": identifier}).scalar_one() == value
                assert conn.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one() == REVISION
                conn.execute(text(restore), {"id": identifier})


def test_empty_database_can_upgrade_and_downgrade_the_commercial_foundation():
    with _database() as (url, _):
        upgraded = _migrate(url, "upgrade", REVISION)
        assert upgraded.returncode == 0, upgraded.stderr
        downgraded = _migrate(url, "downgrade", BASELINE)
        assert downgraded.returncode == 0, downgraded.stderr

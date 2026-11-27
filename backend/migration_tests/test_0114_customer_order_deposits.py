"""Customer order deposits are private, append-only and protect recorded money on downgrade."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import (
    _run_alembic,
    _run_provision,
    _temporary_database,
)
from migration_tests.test_0068_branches import _migrate


def _seed(conn):
    tenant, order = uuid4(), uuid4()
    conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Pasteleria',:slug)"),
                 {"id": tenant, "slug": str(tenant)})
    conn.execute(text(
        "INSERT INTO customer_orders(id,tenant_id,branch_id,folio,status,fulfillment_type,"
        "source_channel,subtotal_amount,total_amount,version,created_at,updated_at) "
        "VALUES(:id,:tenant,:tenant,'PED-0001','new','pickup','counter',600,600,1,now(),now())"
    ), {"id": order, "tenant": tenant})
    return tenant, order


def _insert(conn, tenant, order, kind, method, amount, reason=None):
    conn.execute(text(
        "INSERT INTO customer_order_deposits(id,tenant_id,branch_id,customer_order_id,kind,"
        "method,amount,reason) VALUES(:id,:tenant,:tenant,:order,:kind,:method,:amount,:reason)"
    ), {"id": uuid4(), "tenant": tenant, "order": order, "kind": kind, "method": method,
        "amount": amount, "reason": reason})


def test_deposits_round_trip_enforce_rules_and_refuse_losing_money():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0113_receiving_differences")
        with engine.begin() as conn:
            tenant, order = _seed(conn)

        _run_alembic(url, "0114_customer_order_deposits")
        _run_provision(url)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM payments WHERE deposit_applied")) == 0
            for table in ("customer_order_deposits", "customer_order_settings"):
                assert conn.scalar(text(
                    "SELECT relforcerowsecurity FROM pg_class WHERE relname=:t"), {"t": table})
                for verb, allowed in (("SELECT", True), ("INSERT", True), ("DELETE", False)):
                    assert conn.scalar(text(
                        "SELECT has_table_privilege('kova_app',:t,:verb)"
                    ), {"t": table, "verb": verb}) is allowed
            assert not conn.scalar(text(
                "SELECT has_table_privilege('kova_app','customer_order_deposits','UPDATE')"))

        # Cash needs a shift, money rows need a method, returns and kept balances need a reason.
        for kind, method, reason in (
            ("deposit", "cash", None),
            ("deposit", None, None),
            ("refund", "bank_transfer", None),
            ("retained", "bank_transfer", "Cancelado"),
        ):
            with pytest.raises(DBAPIError) as rejected, engine.begin() as conn:
                _insert(conn, tenant, order, kind, method, 100, reason)
            assert rejected.value.orig.sqlstate == "23514", (kind, method)

        down = _migrate(url.render_as_string(hide_password=False), "downgrade",
                        "0113_receiving_differences")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0114_customer_order_deposits")

        with engine.begin() as conn:
            _insert(conn, tenant, order, "deposit", "bank_transfer", 300)
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0113_receiving_differences")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded customer order deposits" in refused.stderr
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM customer_order_deposits")) == 1

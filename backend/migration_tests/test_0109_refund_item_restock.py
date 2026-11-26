"""Refund restock history is additive and leaves earlier refunds readable."""

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


def test_restocked_quantity_is_null_for_earlier_refunds_and_round_trips():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0108_refund_payments")
        tenant, product, order, item, refund, legacy = [uuid4() for _ in range(6)]
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Restock',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO products(id,tenant_id,name,price_amount) "
                "VALUES(:id,:tenant,'Pan',10)"
            ), {"id": product, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO orders(id,tenant_id,branch_id,status,subtotal_amount,total_amount) "
                "VALUES(:id,:tenant,:tenant,'completed',20,20)"
            ), {"id": order, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO order_items(id,tenant_id,order_id,product_id,product_name,"
                "quantity,unit_price_amount,line_total_amount) "
                "VALUES(:id,:tenant,:order,:product,'Pan',2,10,20)"
            ), {"id": item, "tenant": tenant, "order": order, "product": product})
            conn.execute(text(
                "INSERT INTO refunds(id,tenant_id,branch_id,order_id,reason,refunded_amount,"
                "refund_payment_method,created_at) "
                "VALUES(:id,:tenant,:tenant,:order,'defective',10,'cash',now())"
            ), {"id": refund, "tenant": tenant, "order": order})
            conn.execute(text(
                "INSERT INTO refund_items(id,tenant_id,refund_id,order_item_id,quantity,"
                "unit_price_amount,line_total_amount) "
                "VALUES(:id,:tenant,:refund,:item,1,10,10)"
            ), {"id": legacy, "tenant": tenant, "refund": refund, "item": item})

        _run_alembic(url, "0109_refund_item_restock")
        _run_provision(url)
        with engine.connect() as conn:
            assert conn.scalar(text(
                "SELECT restocked_quantity FROM refund_items WHERE id=:id"
            ), {"id": legacy}) is None
            for verb, allowed in (("SELECT", True), ("INSERT", True), ("UPDATE", False)):
                assert conn.scalar(text(
                    "SELECT has_table_privilege('kova_app','refund_items',:verb)"
                ), {"verb": verb}) is allowed
        with pytest.raises(DBAPIError) as rejected:
            with engine.begin() as conn:
                conn.execute(text(
                    "INSERT INTO refund_items(id,tenant_id,refund_id,order_item_id,quantity,"
                    "unit_price_amount,line_total_amount,restocked_quantity) "
                    "VALUES(:id,:tenant,:refund,:item,1,10,10,2)"
                ), {"id": uuid4(), "tenant": tenant, "refund": refund, "item": item})
        assert rejected.value.orig.sqlstate == "23514"

        result = _migrate(url.render_as_string(hide_password=False), "downgrade",
                          "0108_refund_payments")
        assert result.returncode == 0, result.stderr
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM refund_items")) == 1
        _run_alembic(url, "0109_refund_item_restock")
        with engine.connect() as conn:
            assert conn.scalar(text(
                "SELECT restocked_quantity FROM refund_items WHERE id=:id"
            ), {"id": legacy}) is None

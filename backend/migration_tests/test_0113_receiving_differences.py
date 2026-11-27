"""Receiving differences keep earlier purchases intact and protect recorded evidence."""

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
    tenant, supplier, product, order, item = [uuid4() for _ in range(5)]
    conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Recepcion',:slug)"),
                 {"id": tenant, "slug": str(tenant)})
    conn.execute(text("INSERT INTO products(id,tenant_id,name,price_amount) "
                      "VALUES(:id,:tenant,'Harina',10)"), {"id": product, "tenant": tenant})
    conn.execute(text("INSERT INTO suppliers(id,tenant_id,name,is_active,created_at) "
                      "VALUES(:id,:tenant,'Molino',true,now())"),
                 {"id": supplier, "tenant": tenant})
    conn.execute(text(
        "INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,supplier_name,status,"
        "created_by_user_id,created_at) "
        "VALUES(:id,:tenant,:tenant,:supplier,'Molino','partial',:user,now())"
    ), {"id": order, "tenant": tenant, "supplier": supplier, "user": uuid4()})
    conn.execute(text(
        "INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,product_id,product_name,"
        "quantity,received_quantity,unit_cost) "
        "VALUES(:id,:tenant,:order,:product,'Harina',10,4,4.50)"
    ), {"id": item, "tenant": tenant, "order": order, "product": product})
    return item


def test_receiving_differences_round_trip_and_refuse_losing_evidence():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0112_batch_production")
        with engine.begin() as conn:
            item = _seed(conn)

        _run_alembic(url, "0113_receiving_differences")
        _run_provision(url)
        with engine.connect() as conn:
            row = conn.execute(text(
                "SELECT received_quantity, closed_at, difference_reason "
                "FROM purchase_order_items WHERE id=:id"), {"id": item}).one()
            assert tuple(row) == (4, None, None)
            for column in ("received_quantity", "closed_at", "difference_reason"):
                assert conn.scalar(text(
                    "SELECT has_column_privilege('kova_app','purchase_order_items',:c,'UPDATE')"
                ), {"c": column})
            assert not conn.scalar(text(
                "SELECT has_column_privilege('kova_app','purchase_order_items','unit_cost',"
                "'UPDATE')"))
            assert conn.scalar(text(
                "SELECT count(*) FROM pg_indexes WHERE indexname='ix_orders_tenant_folio'")) == 1
        with pytest.raises(DBAPIError) as rejected, engine.begin() as conn:
            conn.execute(text(
                "UPDATE purchase_order_items SET received_quantity=12 WHERE id=:id"), {"id": item})
        assert rejected.value.orig.sqlstate == "23514"

        # Without recorded differences the revision can go back and forth.
        down = _migrate(url.render_as_string(hide_password=False), "downgrade",
                        "0112_batch_production")
        assert down.returncode == 0, down.stderr
        _run_alembic(url, "0113_receiving_differences")

        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE purchase_order_items SET received_quantity=12, "
                "difference_reason='Bonificación' WHERE id=:id"), {"id": item})
        refused = _migrate(url.render_as_string(hide_password=False), "downgrade",
                           "0112_batch_production")
        assert refused.returncode != 0
        assert "Cannot downgrade recorded receiving differences" in refused.stderr
        with engine.connect() as conn:
            assert conn.scalar(text(
                "SELECT difference_reason FROM purchase_order_items WHERE id=:id"),
                {"id": item}) == "Bonificación"

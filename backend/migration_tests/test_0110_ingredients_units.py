"""Units are additive: existing products stay sellable pieces and round-trip."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0065_tenant_hardening import _run_alembic, _temporary_database
from migration_tests.test_0068_branches import _migrate


def test_existing_products_and_purchase_lines_keep_previous_meaning():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0109_refund_item_restock")
        tenant, product, supplier, order, item = [uuid4() for _ in range(5)]
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Units',:slug)"),
                         {"id": tenant, "slug": str(tenant)})
            conn.execute(text(
                "INSERT INTO products(id,tenant_id,name,price_amount,cost_price) "
                "VALUES(:id,:tenant,'Concha',18,7)"
            ), {"id": product, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO suppliers(id,tenant_id,name,is_active,created_at) "
                "VALUES(:id,:tenant,'Molino',true,now())"
            ), {"id": supplier, "tenant": tenant})
            conn.execute(text(
                "INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,supplier_name,"
                "status,created_by_user_id,created_at) "
                "VALUES(:id,:tenant,:tenant,:supplier,'Molino','pending',:user,now())"
            ), {"id": order, "tenant": tenant, "supplier": supplier, "user": uuid4()})
            conn.execute(text(
                "INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,product_id,"
                "product_name,quantity,received_quantity,unit_cost) "
                "VALUES(:id,:tenant,:order,:product,'Concha',5,0,7)"
            ), {"id": item, "tenant": tenant, "order": order, "product": product})

        _run_alembic(url, "0110_ingredients_units")
        with engine.connect() as conn:
            assert conn.execute(text(
                "SELECT is_sellable, stock_unit, purchase_unit_label, purchase_unit_quantity "
                "FROM products WHERE id=:id"
            ), {"id": product}).one() == (True, "pza", None, None)
            assert conn.execute(text(
                "SELECT units_per_purchase, purchase_unit_label FROM purchase_order_items "
                "WHERE id=:id"
            ), {"id": item}).one() == (1, None)
        for statement in (
            "UPDATE products SET stock_unit='kg' WHERE id=:id",
            "UPDATE products SET purchase_unit_label='Caja' WHERE id=:id",
            "UPDATE products SET purchase_unit_label='Caja', purchase_unit_quantity=0 "
            "WHERE id=:id",
        ):
            with pytest.raises(DBAPIError) as rejected:
                with engine.begin() as conn:
                    conn.execute(text(statement), {"id": product})
            assert rejected.value.orig.sqlstate == "23514"

        result = _migrate(url.render_as_string(hide_password=False), "downgrade",
                          "0109_refund_item_restock")
        assert result.returncode == 0, result.stderr
        _run_alembic(url, "0110_ingredients_units")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT stock_unit FROM products WHERE id=:id"),
                               {"id": product}) == "pza"

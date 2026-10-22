"""Lot integrity must use authoritative tables even with caller-owned temp tables."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.tests.test_inventory_lots import product_with_lots, write

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_lot_stamp_ignores_temporary_product_shadow(client, db):
    tenant, product = product_with_lots(client)
    db.execute(text("CREATE TEMP TABLE products (LIKE public.products) ON COMMIT DROP"))
    db.execute(text("INSERT INTO pg_temp.products SELECT * FROM public.products"))
    db.execute(text("UPDATE pg_temp.products SET track_lots = false"))
    tracked = db.scalar(
        text(
            "INSERT INTO public.inventory_movements "
            "(id, tenant_id, branch_id, product_id, movement_type, quantity_delta, created_at) "
            "VALUES (:id, :tenant, :tenant, :product, 'adjustment', 3, now()) "
            "RETURNING lot_tracked"
        ),
        {"id": uuid4(), "tenant": tenant["tenant_id"], "product": product["id"]},
    )
    assert tracked is True
    db.rollback()


def test_lot_movement_check_ignores_temporary_ledger_shadow(client, db):
    tenant, product = product_with_lots(client)
    db.execute(
        text("CREATE TEMP TABLE inventory_movements (LIKE public.inventory_movements) ON COMMIT DROP")
    )
    with pytest.raises(IntegrityError, match="Lot allocations do not reconcile"):
        db.execute(
            text(
                "INSERT INTO public.inventory_movements "
                "(id, tenant_id, branch_id, product_id, movement_type, quantity_delta, "
                "lot_tracked, created_at) "
                "VALUES (:id, :tenant, :tenant, :product, 'adjustment', 3, true, now())"
            ),
            {"id": uuid4(), "tenant": tenant["tenant_id"], "product": product["id"]},
        )
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.rollback()


def test_lot_reservation_check_ignores_temporary_reservation_shadow(client, db):
    tenant, product = product_with_lots(client)
    response = write(
        client, "/api/v1/customer-orders", {"items": [{"product_id": product["id"], "quantity": 3}]}
    )
    assert response.status_code == 201, response.text
    order = response.json()
    db.execute(
        text(
            "CREATE TEMP TABLE inventory_reservations "
            "(LIKE public.inventory_reservations) ON COMMIT DROP"
        )
    )
    with pytest.raises(IntegrityError, match="Lot reservations do not reconcile"):
        db.execute(
            text(
                "INSERT INTO public.inventory_reservations "
                "(id, tenant_id, branch_id, product_id, customer_order_id, quantity, "
                "lot_tracked, status, created_at, updated_at) "
                "VALUES (:id, :tenant, :tenant, :product, :order, 3, true, 'active', now(), now())"
            ),
            {
                "id": uuid4(),
                "tenant": tenant["tenant_id"],
                "product": product["id"],
                "order": order["id"],
            },
        )
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.rollback()

"""Receiving a purchase that does not match the order: extra units or a short delivery."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.audit.models import AuditLog
from app.catalog.models import Product
from app.orders.models import InventoryMovement
from app.tests.test_orders import _create_product, _signup_verify_login
from app.tests.test_purchasing import post

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _purchase(client, db):
    _signup_verify_login(client, f"recepcion-{uuid4().hex}@example.com", "Panadería")
    flour = _create_product(client, name="Harina", price="10.00", track_inventory=True)
    sugar = _create_product(client, name="Mantequilla", price="10.00", track_inventory=True)
    db.query(Product).filter(Product.id == UUID(flour["id"])).one().low_stock_threshold = 50
    db.commit()
    supplier = post(client, "suppliers", {"name": "Molino"}).json()
    order = post(client, "orders", {
        "supplier_id": supplier["id"],
        "items": [
            {"product_id": flour["id"], "quantity": 10, "unit_cost": "4.50"},
            {"product_id": sugar["id"], "quantity": 5, "unit_cost": "3.00"},
        ],
    })
    assert order.status_code == 201, order.text
    lines = {item["product_name"]: item for item in order.json()["items"]}
    return order.json(), lines["Harina"], lines["Mantequilla"], flour


def _stock(db, product_id) -> int:
    return sum(
        row.quantity_delta
        for row in db.query(InventoryMovement).filter(InventoryMovement.product_id == product_id)
    )


def _receive(client, order, items, key=None):
    return post(client, f"orders/{order['id']}/receive", {"items": items}, key)


def test_short_delivery_closes_the_line_with_its_reason(client, db):
    order, flour, sugar, flour_product = _purchase(client, db)

    missing_reason = _receive(client, order, [
        {"item_id": flour["id"], "quantity": 6, "close_remaining": True},
    ])
    assert missing_reason.status_code == 400
    assert "motivo" in missing_reason.json()["detail"]

    closed = _receive(client, order, [{
        "item_id": flour["id"], "quantity": 6, "close_remaining": True,
        "difference_reason": "  El proveedor no tenía más bultos  ",
    }])
    assert closed.status_code == 200, closed.text
    line = next(item for item in closed.json()["items"] if item["id"] == flour["id"])
    assert (line["received_quantity"], line["difference_reason"]) == (
        6, "El proveedor no tenía más bultos")
    assert line["closed_at"] is not None
    # The other line is still expected, so the purchase stays partial.
    assert closed.json()["status"] == "partial"
    assert _stock(db, UUID(flour_product["id"])) == 6

    # The four missing units are no longer counted as incoming stock.
    incoming = client.get("/api/v1/replenishment").json()
    assert next(r for r in incoming if r["product_id"] == flour_product["id"])[
        "incoming_quantity"] == 0

    again = _receive(client, order, [{"item_id": flour["id"], "quantity": 4}])
    assert again.status_code == 400

    done = _receive(client, order, [{"item_id": sugar["id"], "quantity": 5}])
    assert done.json()["status"] == "received"

    audit = (
        db.query(AuditLog)
        .filter(AuditLog.action == "purchasing.order.receive",
                AuditLog.resource_id == UUID(order["id"]))
        .order_by(AuditLog.created_at)
        .first()
    )
    receipt = audit.changes["receipts"][0]
    assert (receipt["ordered_quantity"], receipt["difference"], receipt["closed_short"]) == (
        10, -4, True)


def test_extra_units_need_a_reason_and_enter_stock(client, db):
    order, flour, sugar, flour_product = _purchase(client, db)

    unexplained = _receive(client, order, [{"item_id": flour["id"], "quantity": 12}])
    assert unexplained.status_code == 400
    assert _stock(db, UUID(flour_product["id"])) == 0

    explained = _receive(client, order, [{
        "item_id": flour["id"], "quantity": 12, "difference_reason": "Bonificación del proveedor",
    }])
    assert explained.status_code == 200, explained.text
    line = next(item for item in explained.json()["items"] if item["id"] == flour["id"])
    assert (line["received_quantity"], line["closed_at"]) == (12, None)
    assert _stock(db, UUID(flour_product["id"])) == 12

    # Over-receipt counts as settled: nothing negative stays incoming.
    incoming = client.get("/api/v1/replenishment").json()
    assert all(row["incoming_quantity"] >= 0 for row in incoming)
    assert _receive(client, order, [{"item_id": sugar["id"], "quantity": 5}]).json()[
        "status"] == "received"


def test_line_can_close_without_another_delivery(client, db):
    order, flour, sugar, flour_product = _purchase(client, db)
    assert _receive(client, order, [{"item_id": flour["id"], "quantity": 4}]).status_code == 200

    empty = _receive(client, order, [{"item_id": sugar["id"], "quantity": 0}])
    assert empty.status_code == 422

    closed = _receive(client, order, [
        {"item_id": flour["id"], "quantity": 0, "close_remaining": True,
         "difference_reason": "Ya no lo surtirán"},
        {"item_id": sugar["id"], "quantity": 0, "close_remaining": True,
         "difference_reason": "Ya no lo surtirán"},
    ], key="close-all")
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "received"
    assert _stock(db, UUID(flour_product["id"])) == 4
    movements = db.query(InventoryMovement).filter(
        InventoryMovement.product_id == UUID(flour_product["id"])).count()
    assert movements == 1

    replay = _receive(client, order, [
        {"item_id": flour["id"], "quantity": 0, "close_remaining": True,
         "difference_reason": "Ya no lo surtirán"},
        {"item_id": sugar["id"], "quantity": 0, "close_remaining": True,
         "difference_reason": "Ya no lo surtirán"},
    ], key="close-all")
    assert replay.json() == closed.json()


def test_database_requires_a_reason_for_any_difference(client, db):
    order, flour, _, _ = _purchase(client, db)
    for sql in (
        "UPDATE purchase_order_items SET received_quantity = quantity + 1 WHERE id = :id",
        "UPDATE purchase_order_items SET closed_at = now() WHERE id = :id",
        "UPDATE purchase_order_items SET closed_at = now(), difference_reason = '  ' "
        "WHERE id = :id",
    ):
        with pytest.raises(IntegrityError, match="ck_purchase_items_difference"):
            db.execute(text(sql), {"id": flour["id"]})
            db.flush()
        db.rollback()

from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import text

from app.catalog.models import Product
from app.orders.models import InventoryMovement, OrderItem
from app.tests.test_orders import _create_product, _signup_verify_login


def post(client, path, body, key=None, branch=None):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.post("/api/v1/purchasing/" + path, json=body, headers=headers)


def setup(client):
    account = _signup_verify_login(client, f"purchases-{uuid4().hex}@example.com", "Compras")
    product = _create_product(client, name="Harina", price="10.00", track_inventory=True)
    supplier = post(client, "suppliers", {"name": "Molino", "contact": "5551234567"})
    assert supplier.status_code == 201, supplier.text
    purchase = post(
        client,
        "orders",
        {
            "supplier_id": supplier.json()["id"],
            "items": [{"product_id": product["id"], "quantity": 10, "unit_cost": "4.50"}],
        },
    )
    assert purchase.status_code == 201, purchase.text
    return account, product, supplier.json(), purchase.json()


def test_partial_receive_replay_cost_and_cancel_preserve_stock(client, db):
    _, product, _, order = setup(client)
    item = order["items"][0]
    payload = {"items": [{"item_id": item["id"], "quantity": 3}]}
    received = post(client, f"orders/{order['id']}/receive", payload, "receive-once")
    assert received.status_code == 200, received.text
    assert received.json()["status"] == "partial"
    assert received.json()["items"][0]["received_quantity"] == 3
    assert (
        post(client, f"orders/{order['id']}/receive", payload, "receive-once").json()
        == received.json()
    )
    stored_product = db.get(Product, UUID(product["id"]))
    assert stored_product.cost_price is None
    movements = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.product_id == product["id"],
            InventoryMovement.movement_type == "purchase",
        )
        .all()
    )
    assert len(movements) == 1 and movements[0].quantity_delta == 3
    assert order["id"] in movements[0].reason and item["id"] in movements[0].reason
    excess = post(
        client, f"orders/{order['id']}/receive", {"items": [{"item_id": item["id"], "quantity": 8}]}
    )
    assert excess.status_code == 400
    updated = post(
        client,
        f"orders/{order['id']}/receive",
        {"items": [{"item_id": item["id"], "quantity": 2}], "update_catalog_cost": True},
    )
    assert updated.status_code == 200, updated.text
    db.refresh(stored_product)
    assert stored_product.cost_price == Decimal("4.50")
    cancelled = post(client, f"orders/{order['id']}/cancel", {})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["items"][0]["received_quantity"] == 5
    assert post(client, f"orders/{order['id']}/receive", payload).status_code == 409
    assert client.get("/api/v1/inventory/stock").json()[0]["stock_on_hand"] == 5


def test_purchase_cross_branch_and_tenant_isolation(client):
    _, product, supplier, order = setup(client)
    branch = client.post(
        "/api/v1/branches", json={"name": "Norte"}, headers={"Idempotency-Key": str(uuid4())}
    )
    assert branch.status_code == 201, branch.text
    branch_id = branch.json()["id"]
    assert (
        client.get("/api/v1/purchasing/orders", headers={"X-Kova-Branch": branch_id}).json() == []
    )
    body = {"items": [{"item_id": order["items"][0]["id"], "quantity": 1}]}
    assert post(client, f"orders/{order['id']}/receive", body, branch=branch_id).status_code == 404
    assert (
        client.get("/api/v1/purchasing/suppliers", headers={"X-Kova-Branch": branch_id}).json()[0][
            "id"
        ]
        == supplier["id"]
    )
    _signup_verify_login(client, f"other-purchases-{uuid4().hex}@example.com", "Otro negocio")
    assert client.get("/api/v1/purchasing/orders").json() == []
    assert client.get("/api/v1/purchasing/suppliers").json() == []
    assert post(client, f"orders/{order['id']}/receive", body).status_code == 404
    assert (
        post(
            client,
            "orders",
            {
                "supplier_id": supplier["id"],
                "items": [{"product_id": product["id"], "quantity": 1, "unit_cost": "4.00"}],
            },
        ).status_code
        == 404
    )


def test_receipt_foreign_items_and_duplicate_payload_rejected(client):
    _, _, _, order = setup(client)
    assert (
        post(
            client,
            f"orders/{order['id']}/receive",
            {"items": [{"item_id": str(uuid4()), "quantity": 1}]},
        ).status_code
        == 400
    )
    item = {"item_id": order["items"][0]["id"], "quantity": 1}
    assert post(client, f"orders/{order['id']}/receive", {"items": [item, item]}).status_code == 422
    assert (
        post(client, f"orders/{order['id']}/receive", {"items": [item]}, "same-key").status_code
        == 200
    )
    assert (
        post(
            client,
            f"orders/{order['id']}/receive",
            {"items": [{**item, "quantity": 2}]},
            "same-key",
        ).status_code
        == 400
    )


def test_purchasing_rls_policies_and_runtime_grants(db, kova_app_engine):
    for table in ("suppliers", "purchase_orders", "purchase_order_items"):
        row = db.execute(
            text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=:table"),
            {"table": table},
        ).one()
        assert row.relrowsecurity and row.relforcerowsecurity
        policy = db.execute(
            text(
                "SELECT qual, with_check FROM pg_policies WHERE tablename=:table AND policyname='tenant_isolation'"
            ),
            {"table": table},
        ).one()
        assert "app.tenant_id" in policy.qual and "app.tenant_id" in policy.with_check
        assert not db.execute(
            text("SELECT has_table_privilege('kova_app', :table, 'DELETE')"), {"table": table}
        ).scalar()


def test_catalog_cost_update_preserves_existing_sale_snapshot(client, db):
    _, product, _, purchase = setup(client)
    patch = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        json={"cost_price": "2.00"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert patch.status_code == 200, patch.text
    seed = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        json={"quantity_delta": 5, "reason": "Stock previo"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert seed.status_code == 201, seed.text
    shift = client.post(
        "/api/v1/shifts",
        json={"opening_cash_amount": "0.00"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert shift.status_code == 201, shift.text
    sale = client.post(
        "/api/v1/orders",
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "cash", "amount": "10.00", "amount_tendered": "10.00"}],
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert sale.status_code == 201, sale.text
    before = db.query(OrderItem).filter(OrderItem.order_id == sale.json()["id"]).one()
    assert before.unit_cost == Decimal("2.00")
    response = post(
        client,
        f"orders/{purchase['id']}/receive",
        {
            "items": [{"item_id": purchase["items"][0]["id"], "quantity": 10}],
            "update_catalog_cost": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "received"
    db.refresh(before)
    assert before.unit_cost == Decimal("2.00")
    assert db.get(Product, UUID(product["id"])).cost_price == Decimal("4.50")

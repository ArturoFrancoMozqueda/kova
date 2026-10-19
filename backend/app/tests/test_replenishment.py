from uuid import uuid4

import pytest

from app.catalog.models import Product
from app.purchasing.models import PurchaseOrder
from app.tests.test_customer_orders import _product, _seed, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _setup(client, db):
    tenant_id = _signup_login(client, prefix="restock")
    product = _product(client)
    row = db.query(Product).filter_by(id=product["id"]).one()
    row.low_stock_threshold = 5
    row.cost_price = "8.50"
    db.commit()
    supplier = client.post(
        "/api/v1/purchasing/suppliers",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Proveedor local"},
    )
    assert supplier.status_code == 201, supplier.text
    return tenant_id, product, supplier.json()


def _body(supplier, row):
    return {
        "supplier_id": supplier["id"],
        "items": [
            {
                "product_id": row["product_id"],
                "quantity": row["suggested_quantity"],
                "unit_cost": row["unit_cost"],
                "evidence_version": row["evidence_version"],
            }
        ],
    }


def test_restock_approval_creates_one_pending_purchase_without_receiving_stock(client, db):
    tenant_id, product, supplier = _setup(client, db)
    response = client.get("/api/v1/replenishment")
    assert response.status_code == 200, response.text
    row = response.json()[0]
    assert row["available_quantity"] == 0
    assert row["suggested_quantity"] == 6
    payload = _body(supplier, row)
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.post("/api/v1/replenishment/approve-purchase", headers=headers, json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "pending"
    replay = client.post("/api/v1/replenishment/approve-purchase", headers=headers, json=payload)
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert db.query(PurchaseOrder).filter_by(tenant_id=tenant_id).count() == 1
    stock = client.get("/api/v1/inventory/stock").json()[0]
    assert stock["stock_on_hand"] == 0
    current = client.get("/api/v1/replenishment").json()[0]
    assert current["incoming_quantity"] == 6
    assert current["suggested_quantity"] == 0


def test_inventory_change_invalidates_restock_approval_without_creating_purchase(client, db):
    tenant_id, product, supplier = _setup(client, db)
    row = client.get("/api/v1/replenishment").json()[0]
    _seed(client, product["id"], 1)
    result = client.post(
        "/api/v1/replenishment/approve-purchase",
        headers={"Idempotency-Key": str(uuid4())},
        json=_body(supplier, row),
    )
    assert result.status_code == 409, result.text
    assert db.query(PurchaseOrder).filter_by(tenant_id=tenant_id).count() == 0


def test_new_purchase_changes_evidence_and_unknown_cost_stays_unknown(client, db):
    tenant_id, product, supplier = _setup(client, db)
    row = client.get("/api/v1/replenishment").json()[0]
    created = client.post(
        "/api/v1/purchasing/orders",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "supplier_id": supplier["id"],
            "items": [{"product_id": product["id"], "quantity": 2, "unit_cost": "8.50"}],
        },
    )
    assert created.status_code == 201, created.text
    result = client.post(
        "/api/v1/replenishment/approve-purchase",
        headers={"Idempotency-Key": str(uuid4())},
        json=_body(supplier, row),
    )
    assert result.status_code == 409
    product_row = db.query(Product).filter_by(tenant_id=tenant_id, id=product["id"]).one()
    product_row.cost_price = None
    db.commit()
    current = client.get("/api/v1/replenishment").json()[0]
    assert current["unit_cost"] is None
    assert current["incoming_quantity"] == 2


def test_restock_is_tenant_scoped_and_requires_inventory_permission(client, db):
    from app.auth.models import Membership

    _setup(client, db)
    client.cookies.clear()
    other = _signup_login(client, prefix="restock-other")
    assert client.get("/api/v1/replenishment").json() == []
    member = db.query(Membership).filter_by(tenant_id=other).one()
    member.role = "cashier"
    db.commit()
    assert client.get("/api/v1/replenishment").status_code == 403

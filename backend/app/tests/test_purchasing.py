from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.branches.scope import bind_branch
from app.catalog.models import Product
from app.db import set_tenant_context
from app.orders.models import InventoryMovement, OrderItem
from app.purchasing import service as purchasing_service
from app.purchasing.models import PurchaseOrder, Supplier
from app.purchasing.schemas import (
    PurchaseCreate,
    PurchaseItemCreate,
    PurchaseReceive,
    ReceiveItem,
    SupplierCreate,
)
from app.tenants.models import Tenant
from app.tests.test_orders import _create_product, _signup_verify_login

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


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


# Separate committed seeds are necessary: these tests use the actual non-owner
# role and independent connections, so the API fixture's rollback-only seeds
# would be invisible to them.
@pytest.fixture
def purchasing_runtime_seed(owner_engine):
    tenants = [uuid4(), uuid4()]
    products = [uuid4(), uuid4()]
    with Session(owner_engine) as db:
        for tenant_id, product_id in zip(tenants, products, strict=True):
            db.add(Tenant(id=tenant_id, name="Runtime purchasing", slug=f"runtime-{tenant_id}"))
            db.flush()
            db.execute(
                text(
                    "INSERT INTO users (id,email,hashed_password,is_email_verified) VALUES (:id,:email,'test-only',true)"
                ),
                {"id": tenant_id, "email": f"runtime-{tenant_id}@example.com"},
            )
            db.execute(
                text("INSERT INTO memberships (tenant_id,user_id,role) VALUES (:id,:id,'owner')"),
                {"id": tenant_id},
            )
            db.add(
                Product(
                    id=product_id,
                    tenant_id=tenant_id,
                    name="Runtime stock",
                    price_amount=Decimal("10.00"),
                    cost_price=Decimal("2.00"),
                    track_inventory=True,
                )
            )
        db.commit()
    try:
        yield tenants, products
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "purchase_order_items",
                "purchase_orders",
                "suppliers",
                "inventory_movements",
                "audit_logs",
                "idempotency_keys",
                "products",
                "branches",
                "memberships",
                "tenants",
                "users",
            ):
                column = "id" if table in ("tenants", "users") else "tenant_id"
                conn.execute(
                    text(f"DELETE FROM {table} WHERE {column} IN (:a, :b)"),
                    {"a": tenants[0], "b": tenants[1]},
                )


def runtime_session(engine, tenant_id):
    db = Session(engine)
    set_tenant_context(db, tenant_id)
    bind_branch(db, tenant_id=tenant_id)
    return db


def runtime_purchase(engine, tenant_id, product_id):
    with runtime_session(engine, tenant_id) as db:
        _, supplier = purchasing_service.create_supplier(
            db,
            tenant_id=tenant_id,
            user_id=tenant_id,
            body=SupplierCreate(name="Runtime supplier"),
            key=str(uuid4()),
        )
        _, order = purchasing_service.create_order(
            db,
            tenant_id=tenant_id,
            user_id=tenant_id,
            body=PurchaseCreate(
                supplier_id=supplier["id"],
                items=[PurchaseItemCreate(product_id=product_id, quantity=10, unit_cost="4.50")],
            ),
            key=str(uuid4()),
        )
        return supplier, order


def test_real_runtime_role_denies_foreign_rows_and_history_updates(
    kova_app_engine, purchasing_runtime_seed
):
    tenants, products = purchasing_runtime_seed
    supplier_a, order_a = runtime_purchase(kova_app_engine, tenants[0], products[0])
    supplier_b, order_b = runtime_purchase(kova_app_engine, tenants[1], products[1])
    with runtime_session(kova_app_engine, tenants[0]) as db:
        assert [row["id"] for row in purchasing_service.orders(db, tenants[0])] == [order_a["id"]]
        # Direct SQL bypasses service filters and proves RLS still blocks B.
        for table in ("suppliers", "purchase_orders", "purchase_order_items"):
            assert (
                db.execute(
                    text(f"SELECT count(*) FROM {table} WHERE tenant_id=:tenant"),
                    {"tenant": tenants[1]},
                ).scalar()
                == 0
            )
        assert (
            db.execute(
                text("UPDATE purchase_orders SET status='cancelled' WHERE id=:id"),
                {"id": order_b["id"]},
            ).rowcount
            == 0
        )
        assert (
            db.execute(
                text(
                    "UPDATE purchase_order_items SET received_quantity=1 WHERE purchase_order_id=:id"
                ),
                {"id": order_b["id"]},
            ).rowcount
            == 0
        )
        db.rollback()
    with runtime_session(kova_app_engine, tenants[0]) as db:
        db.add(Supplier(tenant_id=tenants[1], name="Foreign insert"))
        with pytest.raises(DBAPIError) as denied:
            db.flush()
        assert denied.value.orig.sqlstate == "42501"
    # Historical/cost identity cannot be rewritten through runtime SQL even
    # when a query selects no rows. Column grants, not UX, protect the ledger.
    for sql in (
        "UPDATE purchase_order_items SET unit_cost=0 WHERE false",
        "UPDATE purchase_order_items SET quantity=999 WHERE false",
        "UPDATE purchase_orders SET supplier_id=:supplier WHERE false",
        "UPDATE order_items SET unit_cost=0 WHERE false",
        "UPDATE inventory_movements SET quantity_delta=999 WHERE false",
        "DELETE FROM purchase_orders WHERE false",
    ):
        with runtime_session(kova_app_engine, tenants[0]) as db:
            with pytest.raises(DBAPIError) as denied:
                db.execute(text(sql), {"supplier": supplier_a["id"]})
            assert denied.value.orig.sqlstate == "42501"
    with runtime_session(kova_app_engine, tenants[1]) as db:
        # Composite tenant FK rejects using A's supplier with B's purchase.
        with pytest.raises(IntegrityError):
            db.add(
                PurchaseOrder(
                    tenant_id=tenants[1],
                    supplier_id=UUID(supplier_a["id"]),
                    supplier_name="Foreign supplier",
                    created_by_user_id=uuid4(),
                )
            )
            db.flush()
    with runtime_session(kova_app_engine, tenants[0]) as db:
        _, result = purchasing_service.receive(
            db,
            tenant_id=tenants[0],
            user_id=tenants[0],
            order_id=UUID(order_a["id"]),
            body=PurchaseReceive(
                items=[ReceiveItem(item_id=order_a["items"][0]["id"], quantity=10)],
                update_catalog_cost=True,
            ),
            key=str(uuid4()),
        )
        assert result["status"] == "received"
        assert db.get(Product, products[0]).cost_price == Decimal("4.50")
        assert db.get(Product, products[1]) is None
    with runtime_session(kova_app_engine, tenants[1]) as db:
        assert db.get(Product, products[1]).cost_price == Decimal("2.00")
        assert purchasing_service.orders(db, tenants[1])[0]["status"] == "pending"
        assert purchasing_service.suppliers(db, tenants[1])[0].id == UUID(supplier_b["id"])


def test_concurrent_runtime_receipt_replays_one_stock_effect(
    kova_app_engine, owner_engine, purchasing_runtime_seed
):
    tenants, products = purchasing_runtime_seed
    _, order = runtime_purchase(kova_app_engine, tenants[0], products[0])
    key = str(uuid4())
    start = Barrier(2)
    body = PurchaseReceive(items=[ReceiveItem(item_id=order["items"][0]["id"], quantity=10)])

    def receive_once():
        with runtime_session(kova_app_engine, tenants[0]) as db:
            db.execute(text("SET LOCAL statement_timeout='10s'"))
            start.wait(timeout=5)
            return purchasing_service.receive(
                db,
                tenant_id=tenants[0],
                user_id=tenants[0],
                order_id=UUID(order["id"]),
                body=body,
                key=key,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: receive_once(), range(2)))
    assert results[0] == results[1]
    assert results[0][1]["status"] == "received"
    with Session(owner_engine) as db:
        movements = (
            db.query(InventoryMovement)
            .filter(
                InventoryMovement.tenant_id == tenants[0],
                InventoryMovement.movement_type == "purchase",
            )
            .all()
        )
        assert len(movements) == 1 and movements[0].quantity_delta == 10
        audit = (
            db.query(AuditLog)
            .filter(AuditLog.tenant_id == tenants[0], AuditLog.action == "purchasing.order.receive")
            .one()
        )
        receipt = audit.changes["receipts"][0]
        assert receipt["movement_id"] == str(movements[0].id)
        assert receipt["item_id"] == order["items"][0]["id"]
        assert receipt["unit_cost"] == "4.50"
        assert receipt["previous_catalog_cost"] == "2.00"
        assert receipt["catalog_cost_updated"] is False
        assert db.get(Product, products[0]).cost_price == Decimal("2.00")

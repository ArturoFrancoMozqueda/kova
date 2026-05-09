from uuid import UUID

from fastapi.testclient import TestClient

from app.audit.models import AuditLog
from app.orders.models import InventoryMovement


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return signup


def _create_product(
    client: TestClient,
    *,
    name: str = "Concha",
    price: str = "18.50",
    track_inventory: bool = False,
) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"product-{name}-{track_inventory}"},
        json={"name": name, "price_amount": price, "track_inventory": track_inventory},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_cash_order(client: TestClient, product_id: str, key: str = "order-cash") -> object:
    return client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": key},
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "37.00", "amount_tendered": "40.00"}],
        },
    )


def test_cash_order_uses_server_prices_and_writes_audit(client, db):
    signup = _signup_verify_login(client, "order-cash@example.com", "Cash Order Bakery")
    product = _create_product(client)

    response = _create_cash_order(client, product["id"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["total_amount"] == "37.00"
    assert body["payments"][0]["change_due_amount"] == "3.00"
    assert body["items"][0]["unit_price_amount"] == "18.50"

    audit = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == UUID(signup["tenant_id"]), AuditLog.action == "orders.create")
        .one()
    )
    assert str(audit.resource_id) == body["id"]


def test_bank_transfer_order_records_manual_payment(client):
    _signup_verify_login(client, "order-transfer@example.com", "Transfer Bakery")
    product = _create_product(client, name="Baguette", price="30.00")

    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "order-transfer"},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "30.00", "reference": "SPEI-123"}],
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["payments"][0]["method"] == "bank_transfer"
    assert response.json()["payments"][0]["reference"] == "SPEI-123"


def test_manual_card_order_records_payment(client):
    _signup_verify_login(client, "order-card@example.com", "Card Bakery")
    product = _create_product(client, name="Croissant", price="25.00")

    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "order-card"},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "manual_card", "amount": "25.00", "reference": "terminal-42"}],
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["payments"][0]["method"] == "manual_card"


def test_order_create_idempotency_replays_same_response(client):
    _signup_verify_login(client, "order-idempotent@example.com", "Replay Bakery")
    product = _create_product(client)

    first = _create_cash_order(client, product["id"], key="order-replay")
    second = _create_cash_order(client, product["id"], key="order-replay")

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()


def test_order_idempotency_reuse_with_different_body_returns_400(client):
    _signup_verify_login(client, "order-idempotent-bad@example.com", "Bad Replay Bakery")
    product = _create_product(client)

    first = _create_cash_order(client, product["id"], key="order-replay-bad")
    second = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "order-replay-bad"},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "cash", "amount": "18.50", "amount_tendered": "20.00"}],
        },
    )

    assert first.status_code == 201
    assert second.status_code == 400


def test_tracked_product_creates_inventory_sale_movement(client, db):
    signup = _signup_verify_login(client, "order-inventory@example.com", "Inventory Bakery")
    product = _create_product(client, track_inventory=True)

    response = _create_cash_order(client, product["id"], key="order-inventory")

    assert response.status_code == 201, response.text
    movement = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.tenant_id == UUID(signup["tenant_id"]),
            InventoryMovement.product_id == UUID(product["id"]),
        )
        .one()
    )
    assert movement.movement_type == "sale"
    assert movement.quantity_delta == -2


def test_untracked_product_does_not_create_inventory_movement(client, db):
    signup = _signup_verify_login(client, "order-untracked@example.com", "Untracked Bakery")
    product = _create_product(client, track_inventory=False)

    response = _create_cash_order(client, product["id"], key="order-untracked")

    assert response.status_code == 201, response.text
    movements = (
        db.query(InventoryMovement)
        .filter(
            InventoryMovement.tenant_id == UUID(signup["tenant_id"]),
            InventoryMovement.product_id == UUID(product["id"]),
        )
        .all()
    )
    assert movements == []


def test_payment_mismatch_returns_400(client):
    _signup_verify_login(client, "order-mismatch@example.com", "Mismatch Bakery")
    product = _create_product(client, name="Mismatch", price="30.00")

    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "order-mismatch"},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "29.99"}],
        },
    )

    assert response.status_code == 400

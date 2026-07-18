from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.orders.models import OrderItem


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
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
    name: str = "Offline Concha",
    cost: str | None = None,
) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"offline-product-{name}"},
        json={"name": name, "price_amount": "18.50", "cost_price": cost},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _offline_sale_payload(client_uuid: str, product_id: str) -> dict:
    return {
        "client_uuid": client_uuid,
        "order": {
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "37.00", "amount_tendered": "40.00"}],
        },
    }


def test_offline_sale_sync_creates_order(client):
    _signup_verify_login(client, "offline-sync@example.com", "Offline Bakery")
    product = _create_product(client)
    client_uuid = str(uuid4())

    response = client.post(
        "/api/v1/sync/offline-sales",
        json={"sales": [_offline_sale_payload(client_uuid, product["id"])]},
    )

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "synced"
    assert result["client_uuid"] == client_uuid
    assert result["order"]["total_amount"] == "37.00"


def test_offline_sale_snapshots_cost_only_from_server_catalog(client, db):
    signup = _signup_verify_login(client, "offline-cost@example.com", "Offline Cost Bakery")
    product = _create_product(client, name="Offline Costed Concha", cost="6.75")

    response = client.post(
        "/api/v1/sync/offline-sales",
        json={"sales": [_offline_sale_payload(str(uuid4()), product["id"])]},
    )

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "synced"
    item = (
        db.query(OrderItem)
        .filter(
            OrderItem.tenant_id == UUID(signup["tenant_id"]),
            OrderItem.order_id == UUID(result["order_id"]),
        )
        .one()
    )
    assert item.unit_cost == Decimal("6.75")


def test_offline_sale_replay_returns_same_order(client):
    _signup_verify_login(client, "offline-replay@example.com", "Offline Replay Bakery")
    product = _create_product(client, name="Replay Concha")
    payload = _offline_sale_payload(str(uuid4()), product["id"])

    first = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})
    second = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_result = first.json()["results"][0]
    second_result = second.json()["results"][0]
    assert first_result["status"] == "synced"
    assert second_result["status"] == "synced"
    assert second_result["order_id"] == first_result["order_id"]


def test_offline_sync_invalid_sale_returns_failed_result(client):
    _signup_verify_login(client, "offline-invalid@example.com", "Offline Invalid Bakery")

    response = client.post(
        "/api/v1/sync/offline-sales",
        json={
            "sales": [
                _offline_sale_payload(str(uuid4()), str(uuid4())),
            ]
        },
    )

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "failed"
    assert result["order_id"] is None
    assert "Product not found" in result["error"]

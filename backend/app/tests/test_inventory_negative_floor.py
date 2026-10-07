"""D5 — manual stock adjustments cannot drive on-hand negative."""
from uuid import uuid4

import pytest

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_verify_login(client, email: str, tenant_name: str) -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
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


def _create_tracked_product(client) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"neg-floor-product-{uuid4().hex}"},
        json={
            "name": "Floor Product",
            "sku": f"FLOOR-{uuid4().hex[:8]}",
            "price_amount": "10.00",
            "track_inventory": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _adjust(client, product_id: str, delta: int, reason: str):
    return client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": f"neg-floor-adjust-{uuid4().hex}"},
        json={"quantity_delta": delta, "reason": reason},
    )


def _stock_on_hand(client, product_id: str) -> int:
    response = client.get("/api/v1/inventory/stock")
    assert response.status_code == 200, response.text
    item = next(row for row in response.json() if row["product_id"] == product_id)
    return item["stock_on_hand"]


def test_adjustment_below_zero_is_rejected(client):
    _signup_verify_login(client, f"neg-floor-{uuid4().hex}@example.com", "Floor Tenant")
    product = _create_tracked_product(client)
    assert _adjust(client, product["id"], 5, "opening_count").status_code == 201

    response = _adjust(client, product["id"], -100, "shrink")

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "WOULD_GO_NEGATIVE"
    # On-hand unchanged after the rejected adjustment.
    assert _stock_on_hand(client, product["id"]) == 5


def test_adjustment_down_to_zero_is_allowed(client):
    _signup_verify_login(client, f"neg-floor-zero-{uuid4().hex}@example.com", "Floor Zero Tenant")
    product = _create_tracked_product(client)
    assert _adjust(client, product["id"], 5, "opening_count").status_code == 201

    response = _adjust(client, product["id"], -5, "correction")

    assert response.status_code == 201, response.text
    assert _stock_on_hand(client, product["id"]) == 0

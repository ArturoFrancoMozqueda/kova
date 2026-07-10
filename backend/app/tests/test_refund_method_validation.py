"""D4 — refund method/amount validated against what was collected per method.

A refund can only be paid back through a method that actually collected money
for the order, and never more than was collected in that method (minus prior
refunds to it). This blocks draining the cash drawer for money that was never
in it (e.g. a transfer-only order refunded in cash).
"""
from decimal import Decimal
from uuid import uuid4


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


def _open_shift(client) -> dict:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"refund-method-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _current_shift(client) -> dict:
    response = client.get("/api/v1/shifts/current")
    assert response.status_code == 200, response.text
    return response.json()


def _create_product(client, *, name: str, price: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"refund-method-product-{uuid4().hex}"},
        json={"name": name, "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _order(client, *, items: list[dict], payments: list[dict]) -> dict:
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"refund-method-order-{uuid4().hex}"},
        json={"items": items, "payments": payments},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _refund(client, order_id: str, payload: dict):
    return client.post(
        f"/api/v1/orders/{order_id}/refunds",
        headers={"Idempotency-Key": f"refund-method-refund-{uuid4().hex}"},
        json=payload,
    )


def test_cash_refund_on_transfer_only_order_rejected(client):
    _signup_verify_login(client, f"refund-transfer-{uuid4().hex}@example.com", "Transfer Tenant")
    _open_shift(client)
    product = _create_product(client, name="Transfer Cake", price="50.00")
    order = _order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "bank_transfer", "amount": "50.00"}],
    )

    response = _refund(
        client,
        order["id"],
        {
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "REFUND_METHOD_EXCEEDS_COLLECTED"


def test_over_cash_refund_on_split_order_rejected(client):
    _signup_verify_login(client, f"refund-split-{uuid4().hex}@example.com", "Split Tenant")
    _open_shift(client)
    # 30 collected in cash, 20 in transfer.
    product = _create_product(client, name="Split Cake", price="50.00")
    order = _order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
    )

    # A full-value cash refund (50) exceeds the 30 collected in cash.
    response = _refund(
        client,
        order["id"],
        {
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "REFUND_METHOD_EXCEEDS_COLLECTED"


def test_valid_cash_refund_reduces_expected_cash(client):
    _signup_verify_login(client, f"refund-valid-{uuid4().hex}@example.com", "Valid Tenant")
    shift = _open_shift(client)
    product = _create_product(client, name="Cash Cake", price="40.00")
    order = _order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "40.00", "amount_tendered": "40.00"}],
    )

    before = Decimal(_current_shift(client)["expected_cash_amount"])
    assert before == Decimal(shift["opening_cash_amount"]) + Decimal("40.00")

    response = _refund(
        client,
        order["id"],
        {
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert response.status_code == 201, response.text

    after = Decimal(_current_shift(client)["expected_cash_amount"])
    assert after == before - Decimal("40.00")


def test_refund_payment_method_is_required(client):
    _signup_verify_login(client, f"refund-required-{uuid4().hex}@example.com", "Required Tenant")
    _open_shift(client)
    product = _create_product(client, name="Required Cake", price="10.00")
    order = _order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "10.00", "amount_tendered": "10.00"}],
    )

    response = _refund(
        client,
        order["id"],
        {
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
        },
    )

    assert response.status_code == 422, response.text

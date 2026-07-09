from decimal import Decimal
from uuid import uuid4


def _signup_verify_login(client, email: str, tenant_name: str) -> None:
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


def _open_shift(client) -> dict:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"refund-money-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_product(client, *, name: str, price: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"refund-money-product-{uuid4().hex}"},
        json={"name": name, "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_refund_amount_uses_decimal_line_totals(client):
    suffix = uuid4().hex
    _signup_verify_login(
        client,
        f"refund-money-{suffix}@example.com",
        "Refund Money Tenant",
    )
    _open_shift(client)
    first = _create_product(client, name="Golden Cookie", price="19.99")
    second = _create_product(client, name="Golden Cake", price="10.50")

    order_response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"refund-money-order-{suffix}"},
        json={
            "items": [
                {"product_id": first["id"], "quantity": 1},
                {"product_id": second["id"], "quantity": 1},
            ],
            "payments": [
                {
                    "method": "cash",
                    "amount": "30.49",
                    "amount_tendered": "30.49",
                }
            ],
        },
    )
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()

    refund_response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-money-refund-{suffix}"},
        json={
            "items": [{"order_item_id": item["id"], "quantity": 1} for item in order["items"]],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund_response.status_code == 201, refund_response.text
    refund = refund_response.json()

    assert Decimal(refund["refunded_amount"]) == Decimal("30.49")
    assert sorted(Decimal(item["line_total_amount"]) for item in refund["items"]) == [
        Decimal("10.50"),
        Decimal("19.99"),
    ]

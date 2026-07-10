"""D6 — payment-mix reconciles to net sales after refunds.

Cash refunds are drawer movements, not negative payments, so the raw payment
sum overstated collections on a refund day and never tied to net_sales. The
breakdown now exposes per-method refunds/net plus a net_total that equals
net_sales.
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
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text


def _open_shift(client) -> None:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"mix-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text


def test_payment_mix_reconciles_to_net_sales_after_cash_refund(client):
    _signup_verify_login(client, f"mix-{uuid4().hex}@example.com", "Mix Tenant")
    _open_shift(client)

    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"mix-product-{uuid4().hex}"},
        json={"name": "Mix Cake", "price_amount": "40.00", "track_inventory": False},
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"mix-order-{uuid4().hex}"},
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "80.00", "amount_tendered": "80.00"}],
        },
    )
    assert order.status_code == 201, order.text
    order_json = order.json()

    refund = client.post(
        f"/api/v1/orders/{order_json['id']}/refunds",
        headers={"Idempotency-Key": f"mix-refund-{uuid4().hex}"},
        json={
            "items": [{"order_item_id": order_json["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund.status_code == 201, refund.text

    summary = client.get("/api/v1/reports/sales-summary")
    assert summary.status_code == 200, summary.text
    net_sales = Decimal(summary.json()["net_sales"])
    assert net_sales == Decimal("40.00")  # 80 collected − 40 refunded

    breakdown = client.get("/api/v1/reports/payment-breakdown")
    assert breakdown.status_code == 200, breakdown.text
    body = breakdown.json()

    # Gross collection is unchanged; the net view nets out the refund.
    assert Decimal(body["gross_total"]) == Decimal("80.00")
    assert Decimal(body["refund_total"]) == Decimal("40.00")
    assert Decimal(body["net_total"]) == net_sales

    cash_row = next(row for row in body["payments"] if row["method"] == "cash")
    assert Decimal(cash_row["amount"]) == Decimal("80.00")
    assert Decimal(cash_row["refunded_amount"]) == Decimal("40.00")
    assert Decimal(cash_row["net_amount"]) == Decimal("40.00")

    # The per-method net amounts sum to the net total (all refunds attributed).
    net_from_rows = sum((Decimal(row["net_amount"]) for row in body["payments"]), Decimal("0.00"))
    assert net_from_rows == net_sales

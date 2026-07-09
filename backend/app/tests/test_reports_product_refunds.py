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


def _open_shift(client) -> None:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"reports-product-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text


def test_product_reports_discount_refunded_items(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-product-refund-{suffix}@example.com", "Reports Product Refund")
    _open_shift(client)

    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"reports-product-refund-product-{suffix}"},
        json={"name": "QA Product Refund", "price_amount": "12.00", "track_inventory": True},
    )
    assert product.status_code == 201, product.text
    product_json = product.json()

    stock = client.post(
        f"/api/v1/inventory/products/{product_json['id']}/adjustments",
        headers={"Idempotency-Key": f"reports-product-refund-stock-{suffix}"},
        json={"quantity_delta": 10, "reason": "seed stock"},
    )
    assert stock.status_code == 201, stock.text

    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"reports-product-refund-order-{suffix}"},
        json={
            "items": [{"product_id": product_json["id"], "quantity": 2}],
            "payments": [{"method": "cash", "amount": "24.00", "amount_tendered": "24.00"}],
        },
    )
    assert order.status_code == 201, order.text
    order_json = order.json()

    refund = client.post(
        f"/api/v1/orders/{order_json['id']}/refunds",
        headers={"Idempotency-Key": f"reports-product-refund-refund-{suffix}"},
        json={
            "items": [{"order_item_id": order_json["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund.status_code == 201, refund.text

    top_products = client.get("/api/v1/reports/top-products")
    assert top_products.status_code == 200, top_products.text
    product_rows = {
        row["product_id"]: row
        for row in top_products.json()["products"]
    }
    product_row = product_rows[product_json["id"]]
    assert product_row["quantity_sold"] == 1
    assert Decimal(product_row["gross_sales"]) == Decimal("12.00")

    story = client.get("/api/v1/reports/business-story")
    assert story.status_code == 200, story.text
    story_row = story.json()["product_drivers"][0]
    assert story_row["quantity_sold"] == 1
    assert Decimal(story_row["gross_sales"]) == Decimal("12.00")

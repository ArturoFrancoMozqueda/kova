from decimal import Decimal
from uuid import uuid4


def _signup_verify_login(client) -> None:
    suffix = uuid4().hex
    email = f"report-margin-{suffix}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": "Margin Bakery",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    verify = client.post(
        "/api/v1/auth/verify",
        json={"token": signup.json()["dev_verification_token"]},
    )
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text


def _create_product(client, *, name: str, cost: str | None) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"margin-product-{uuid4().hex}"},
        json={
            "name": name,
            "price_amount": "20.00",
            "cost_price": cost,
            "track_inventory": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _add_stock(client, product_id: str, quantity: int) -> None:
    response = client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": f"margin-stock-{uuid4().hex}"},
        json={"quantity_delta": quantity, "reason": "initial stock"},
    )
    assert response.status_code == 201, response.text


def _create_order(client, product_id: str, *, quantity: int) -> dict:
    total = Decimal("20.00") * quantity
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"margin-order-{uuid4().hex}"},
        json={
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payments": [
                {
                    "method": "cash",
                    "amount": str(total),
                    "amount_tendered": str(total),
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_margin_uses_sale_snapshot_nets_refunds_and_never_estimates_missing_cost(client):
    _signup_verify_login(client)
    shift = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"margin-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert shift.status_code == 201, shift.text

    costed = _create_product(client, name="Costed Concha", cost="8.00")
    _add_stock(client, costed["id"], 10)
    order = _create_order(client, costed["id"], quantity=3)
    refund = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"margin-refund-{uuid4().hex}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund.status_code == 201, refund.text

    update = client.patch(
        f"/api/v1/catalog/products/{costed['id']}",
        headers={"Idempotency-Key": f"margin-cost-update-{uuid4().hex}"},
        json={"cost_price": "9.00"},
    )
    assert update.status_code == 200, update.text

    complete = client.get("/api/v1/reports/business-story")
    assert complete.status_code == 200, complete.text
    story = complete.json()
    summary = story["margin"]["summary"]
    assert summary["complete"] is True
    assert Decimal(summary["net_sales"]) == Decimal("40.00")
    assert Decimal(summary["cogs"]) == Decimal("16.00")
    assert Decimal(summary["gross_profit"]) == Decimal("24.00")
    assert Decimal(summary["gross_margin_pct"]) == Decimal("60.00")
    assert story["margin"]["by_product"][0]["quantity_sold"] == 2
    [day] = story["margin"]["by_day"]
    assert Decimal(day["cogs"]) == Decimal("16.00")
    assert Decimal(day["gross_profit"]) == Decimal("24.00")
    assert day["complete"] is True
    assert Decimal(story["inventory_valuation"]["value"]) == Decimal("72.00")

    unknown = _create_product(client, name="Unknown Cost Muffin", cost=None)
    _add_stock(client, unknown["id"], 5)
    _create_order(client, unknown["id"], quantity=1)

    incomplete = client.get("/api/v1/reports/business-story")
    assert incomplete.status_code == 200, incomplete.text
    story = incomplete.json()
    summary = story["margin"]["summary"]
    assert summary["complete"] is False
    assert summary["sold_products_without_cost"] == 1
    assert summary["cogs"] is None
    assert summary["gross_profit"] is None
    assert summary["gross_margin_pct"] is None
    rows = {row["product_name"]: row for row in story["margin"]["by_product"]}
    assert Decimal(rows["Costed Concha"]["gross_profit"]) == Decimal("24.00")
    assert rows["Unknown Cost Muffin"]["gross_profit"] is None
    assert rows["Unknown Cost Muffin"]["missing_cost"] is True
    [day] = story["margin"]["by_day"]
    assert day["cogs"] is None
    assert day["gross_profit"] is None
    assert day["products_without_cost"] == 1
    assert day["complete"] is False

    valuation = story["inventory_valuation"]
    assert valuation["complete"] is False
    assert valuation["value"] is None
    assert Decimal(valuation["known_value"]) == Decimal("72.00")
    assert valuation["products_without_cost"] == 1
    assert valuation["units_without_cost"] == 4

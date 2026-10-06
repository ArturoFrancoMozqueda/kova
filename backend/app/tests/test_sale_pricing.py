from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from app.customers.models import Customer  # noqa: F401 - register tenant FK metadata
from app.orders.models import Order, OrderItem
from app.pricing import calculator
from app.reports.service import _margin_report, _net_item_rows
from app.tests.test_orders import _create_product, _signup_verify_login


def test_discount_tax_cents_and_rounding():
    subtotal, tax, total, lines = calculator.sale_pricing(
        [Decimal("0.01"), Decimal("0.02"), Decimal("100.00")], Decimal("0.01"), Decimal("16")
    )
    assert subtotal == Decimal("100.03")
    assert tax == Decimal("16.00")
    assert total == sum(lines) == Decimal("116.02")
    assert all(line >= 0 for line in lines)
    assert sum(
        calculator.refund_line_total(Decimal("10.00"), 3, n, 1) for n in range(3)
    ) == Decimal("10.00")
    with pytest.raises(ValueError):
        calculator.sale_pricing([Decimal("10")], Decimal("10.01"), Decimal("16"))


def _sale(product_id):
    return {
        "items": [{"product_id": product_id, "quantity": 3}],
        "discount_amount": "1.00",
        "tax_rate": "16.00",
        "payments": [{"method": "bank_transfer", "amount": "33.64"}],
    }


def test_receipt_margin_and_partial_refunds(client, db):
    signup = _signup_verify_login(client, "pricing@example.com", "Pricing")
    product = _create_product(client, price="10.00", cost="4.00")
    payload = _sale(product["id"])
    response = client.post("/api/v1/orders", headers={"Idempotency-Key": "pricing"}, json=payload)
    assert response.status_code == 201, response.text
    sale = response.json()
    assert sale["subtotal_amount"] == "30.00"
    assert sale["discount_amount"] == "1.00"
    assert sale["tax_amount"] == "4.64"
    assert sale["total_amount"] == sale["items"][0]["line_total_amount"] == "33.64"
    receipt = client.get(f"/api/v1/orders/{sale['id']}/receipt")
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["tax_amount"] == "4.64"
    replay = client.post("/api/v1/orders", headers={"Idempotency-Key": "pricing"}, json=payload)
    assert replay.status_code == 201 and replay.json()["id"] == sale["id"]
    order_id = UUID(sale["id"])
    rows = _net_item_rows(db, tenant_id=UUID(signup["tenant_id"]), order_ids=[order_id])
    assert rows[0]["net_sales_before_tax"] == Decimal("29.00")
    order = db.query(Order).filter(Order.id == order_id).one()
    margin = _margin_report(orders=[order], item_rows=rows, tz=ZoneInfo("UTC"))
    assert margin["summary"]["gross_profit"] == Decimal("17.00")
    amounts = []
    for n in range(3):
        refund = client.post(
            f"/api/v1/orders/{sale['id']}/refunds",
            headers={"Idempotency-Key": f"pricing-refund-{n}"},
            json={
                "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
                "reason": "customer_return",
                "refund_payment_method": "bank_transfer",
            },
        )
        assert refund.status_code == 201, refund.text
        amounts.append(Decimal(refund.json()["refunded_amount"]))
    assert amounts == [Decimal("11.21"), Decimal("11.22"), Decimal("11.21")]
    assert sum(amounts) == Decimal("33.64")
    assert _net_item_rows(db, tenant_id=UUID(signup["tenant_id"]), order_ids=[order_id]) == []


def test_discount_and_customer_rejections(client, db):
    other = _signup_verify_login(client, "pricing-other@example.com", "Other")
    foreign_customer = Customer(tenant_id=UUID(other["tenant_id"]), name="Foreign", is_active=True)
    db.add(foreign_customer)
    db.commit()
    foreign_id = foreign_customer.id
    _signup_verify_login(client, "pricing-safe@example.com", "Safe")
    product = _create_product(client, price="10.00")
    payload = _sale(product["id"])
    payload["discount_amount"] = "30.01"
    bad = client.post("/api/v1/orders", headers={"Idempotency-Key": "pricing-excess"}, json=payload)
    assert bad.status_code == 400, bad.text
    payload = _sale(product["id"])
    payload["customer_id"] = str(foreign_id)
    foreign = client.post(
        "/api/v1/orders", headers={"Idempotency-Key": "pricing-foreign"}, json=payload
    )
    assert foreign.status_code == 404, foreign.text


def test_offline_snapshot_and_retry(client, db):
    _signup_verify_login(client, "pricing-offline@example.com", "Offline")
    product = _create_product(client, price="20.00")
    payload = _sale(product["id"])
    payload["items"][0]["unit_price_amount"] = "10.00"
    request = {"sales": [{"client_uuid": str(uuid4()), "order": payload}]}
    first = client.post("/api/v1/sync/offline-sales", json=request)
    assert first.status_code == 200, first.text
    result = first.json()["results"][0]
    assert result["status"] == "synced", result
    assert result["order"]["total_amount"] == "33.64"
    again = client.post("/api/v1/sync/offline-sales", json=request)
    assert again.json()["results"][0]["order_id"] == result["order_id"]
    assert db.query(OrderItem).filter(OrderItem.order_id == UUID(result["order_id"])).count() == 1


def test_tax_default_survives_older_settings_writes(client):
    _signup_verify_login(client, "pricing-settings@example.com", "Settings")
    endpoint = "/api/v1/settings/receipt"
    payload = {"receipt_business_name": "Settings", "default_tax_rate": "16.00"}
    saved = client.put(endpoint, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["default_tax_rate"] == "16.00"
    old = client.put(endpoint, json={"receipt_business_name": "Renamed"})
    assert old.status_code == 200, old.text
    assert old.json()["default_tax_rate"] == "16.00"
    invalid = client.put(endpoint, json={**payload, "default_tax_rate": "100.01"})
    assert invalid.status_code == 422

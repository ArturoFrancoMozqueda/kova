"""D4 — refund method/amount validated against what was collected per method.

A refund can only be paid back through a method that actually collected money
for the order, and never more than was collected in that method (minus prior
refunds to it). This blocks draining the cash drawer for money that was never
in it (e.g. a transfer-only order refunded in cash).
"""
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.orders.models import InventoryMovement, Refund, RefundPayment

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


def test_split_refund_returns_one_item_once_and_reconciles_every_method(client, db):
    _signup_verify_login(client, f"refund-allocated-{uuid4().hex}@example.com", "Split return")
    _open_shift(client)
    product_response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Pastel", "price_amount": "50.00", "track_inventory": True},
    )
    assert product_response.status_code == 201, product_response.text
    product = product_response.json()
    adjustment = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        headers={"Idempotency-Key": str(uuid4())},
        json={"quantity_delta": 2, "reason": "Stock de prueba"},
    )
    assert adjustment.status_code == 201, adjustment.text
    order = _order(
        client, items=[{"product_id": product["id"], "quantity": 1}],
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
    )
    payload = {
        "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return",
        "refund_payments": [
            {"method": "cash", "amount": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
    }
    headers = {"Idempotency-Key": str(uuid4())}
    url = f"/api/v1/orders/{order['id']}/refunds"
    first = client.post(url, json=payload, headers=headers)
    assert first.status_code == 201, first.text
    replay = client.post(url, json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert Decimal(first.json()["refunded_amount"]) == Decimal("50.00")
    assert first.json()["payments"] == payload["refund_payments"]
    assert db.query(Refund).filter(Refund.order_id == UUID(order["id"])).count() == 1
    assert db.query(RefundPayment).filter(
        RefundPayment.refund_id == UUID(first.json()["id"])
    ).count() == 2
    movements = db.query(InventoryMovement).filter(
        InventoryMovement.order_id == UUID(order["id"])
    ).all()
    assert sorted(movement.quantity_delta for movement in movements) == [-1, 1]
    shift = _current_shift(client)
    assert Decimal(shift["expected_cash_amount"]) == Decimal("100.00")
    payouts = [movement for movement in shift["movements"] if movement["type"] == "refund_payout"]
    assert len(payouts) == 1
    assert Decimal(payouts[0]["amount"]) == Decimal("30.00")
    receipt = client.get(f"/api/v1/orders/{order['id']}/receipt").json()
    assert len(receipt["refunds"]) == 1
    assert {row["method"]: Decimal(row["amount"]) for row in receipt["refunds"][0]["payments"]} == {
        "cash": Decimal("30.00"), "bank_transfer": Decimal("20.00"),
    }
    breakdown = client.get("/api/v1/reports/payment-breakdown")
    assert breakdown.status_code == 200, breakdown.text
    assert Decimal(breakdown.json()["net_total"]) == Decimal("0.00")
    for payment in breakdown.json()["payments"]:
        assert Decimal(payment["net_amount"]) == Decimal("0.00")
    assert _refund(client, order["id"], payload).status_code == 422


def test_split_refund_respects_prior_legacy_refunds_and_per_method_limits(client, db):
    _signup_verify_login(client, f"refund-prior-{uuid4().hex}@example.com", "Prior return")
    _open_shift(client)
    product = _create_product(client, name="Pastel", price="25.00")
    order = _order(
        client, items=[{"product_id": product["id"], "quantity": 2}],
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
    )
    base = {"items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return"}
    first = _refund(client, order["id"], {**base, "refund_payment_method": "cash"})
    assert first.status_code == 201, first.text
    # Represent a pre-0108 single-method refund, whose parent is its only
    # financial record; the current reader must count this fallback once.
    db.query(RefundPayment).filter(
        RefundPayment.refund_id == UUID(first.json()["id"])
    ).delete()
    db.commit()
    over = _refund(client, order["id"], {**base, "refund_payments": [
        {"method": "cash", "amount": "10.00"}, {"method": "bank_transfer", "amount": "15.00"},
    ]})
    assert over.status_code == 422, over.text
    assert over.json()["detail"]["code"] == "REFUND_METHOD_EXCEEDS_COLLECTED"
    assert over.json()["detail"]["available"] == "5.00"
    valid = _refund(client, order["id"], {**base, "refund_payments": [
        {"method": "cash", "amount": "5.00"}, {"method": "bank_transfer", "amount": "20.00"},
    ]})
    assert valid.status_code == 201, valid.text
    assert Decimal(_current_shift(client)["expected_cash_amount"]) == Decimal("100.00")


@pytest.mark.parametrize("payments,expected", [
    ([{"method": "cash", "amount": "30.00"}, {"method": "bank_transfer", "amount": "19.99"}], 400),
    ([{"method": "cash", "amount": "30.00"}, {"method": "cash", "amount": "20.00"}], 422),
    ([{"method": "cash", "amount": "0.00"}, {"method": "bank_transfer", "amount": "50.00"}], 422),
])
def test_invalid_refund_allocation_does_not_write(client, payments, expected):
    _signup_verify_login(client, f"refund-invalid-{uuid4().hex}@example.com", "Invalid return")
    product = _create_product(client, name="Pastel", price="50.00")
    order = _order(client, items=[{"product_id": product["id"], "quantity": 1}],
                   payments=[{"method": "bank_transfer", "amount": "50.00"}])
    response = _refund(client, order["id"], {
        "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return", "refund_payments": payments,
    })
    assert response.status_code == expected, response.text
    assert client.get(f"/api/v1/orders/{order['id']}/refunds").json() == []

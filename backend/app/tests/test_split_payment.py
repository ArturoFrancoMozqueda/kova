"""Split payment + receipt golden tests (Sprint 3)."""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _open_shift(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"split-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _setup(client: TestClient, email: str, tenant: str, price: str = "50.00") -> dict:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    signup = r.json()
    client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    _open_shift(client)
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "split-product"},
        json={"name": "Split Product", "price_amount": price},
    )
    assert product.status_code == 201, product.text
    return {"signup": signup, "product": product.json()}


# ── Split payment integration tests ───────────────────────────────────────────


def test_cash_plus_manual_card_split(client):
    ctx = _setup(client, "split-cash-card@example.com", "Split CC Bakery")
    product_id = ctx["product"]["id"]

    r = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "split-cc-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "20.00", "amount_tendered": "20.00"},
                {"method": "manual_card", "amount": "30.00"},
            ],
        },
    )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["total_amount"] == "50.00"
    assert len(body["payments"]) == 2


def test_cash_change_on_split_partial_cash(client):
    ctx = _setup(client, "split-change@example.com", "Change Bakery")
    product_id = ctx["product"]["id"]

    r = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "split-change-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "30.00", "amount_tendered": "50.00"},
                {"method": "bank_transfer", "amount": "20.00"},
            ],
        },
    )

    assert r.status_code == 201, r.text
    cash_p = next(p for p in r.json()["payments"] if p["method"] == "cash")
    assert cash_p["change_due_amount"] == "20.00"


def test_payment_sum_mismatch_returns_400(client):
    ctx = _setup(client, "split-mismatch@example.com", "Mismatch Bakery")
    product_id = ctx["product"]["id"]

    r = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "split-mismatch-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
                {"method": "bank_transfer", "amount": "10.00"},
            ],
        },
    )

    assert r.status_code == 400


def test_cash_tendered_less_than_amount_returns_400(client):
    ctx = _setup(client, "split-tendered-low@example.com", "Low Tender Bakery")
    product_id = ctx["product"]["id"]

    r = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "split-tendered-low-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 1}],
            "payments": [{"method": "cash", "amount": "50.00", "amount_tendered": "40.00"}],
        },
    )

    assert r.status_code == 400


# ── Receipt tests ─────────────────────────────────────────────────────────────

def test_receipt_single_payment(client):
    ctx = _setup(client, "receipt-single@example.com", "Receipt Bakery")
    product_id = ctx["product"]["id"]

    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "receipt-single-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "100.00", "amount_tendered": "100.00"}],
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]

    r = client.get(f"/api/v1/orders/{order_id}/receipt")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tenant_name"] == "Receipt Bakery"
    assert body["total_amount"] == "100.00"
    assert len(body["items"]) == 1
    assert body["items"][0]["quantity"] == 2
    assert body["total_change"] == "0.00"
    assert len(body["receipt_number"]) == 8


def test_receipt_split_payment_totals(client):
    ctx = _setup(client, "receipt-split@example.com", "Receipt Split Bakery")
    product_id = ctx["product"]["id"]

    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "receipt-split-order"},
        json={
            "items": [{"product_id": product_id, "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "30.00", "amount_tendered": "40.00"},
                {"method": "bank_transfer", "amount": "20.00"},
            ],
        },
    )
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]

    r = client.get(f"/api/v1/orders/{order_id}/receipt")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_amount"] == "50.00"
    assert body["total_tendered"] == "40.00"
    assert body["total_change"] == "10.00"
    assert len(body["payments"]) == 2


def test_receipt_unknown_order_returns_404(client):
    _setup(client, "receipt-404@example.com", "404 Bakery")
    import uuid
    r = client.get(f"/api/v1/orders/{uuid.uuid4()}/receipt")
    assert r.status_code == 404

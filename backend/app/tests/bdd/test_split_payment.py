from uuid import uuid4

import pytest
from pytest_bdd import given, parsers, scenario, then, when

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _open_shift(client) -> dict:
    r = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"bdd-split-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert r.status_code == 201, r.text
    return r.json()


@scenario(
    "../../../../specs/orders/split_payment.feature",
    "Cashier completes a split cash and bank transfer payment",
)
def test_cashier_completes_split_cash_and_bank_transfer():
    pass


@scenario(
    "../../../../specs/orders/split_payment.feature",
    "Payment sum mismatch is rejected",
)
def test_payment_sum_mismatch_is_rejected():
    pass


@given(
    parsers.parse('a verified tenant owner with a product priced at "{price}"'),
    target_fixture="split_context",
)
def verified_tenant_owner_with_product(client, price):
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": "bdd-split@example.com", "password": "S3cur3pass!", "tenant_name": "Split BDD Bakery", "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    token = r.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    client.post("/api/v1/auth/login", json={"email": "bdd-split@example.com", "password": "S3cur3pass!"})
    _open_shift(client)
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bdd-split-product"},
        json={"name": "BDD Split Product", "price_amount": price},
    )
    assert product.status_code == 201, product.text
    return {"client": client, "product": product.json(), "price": price}


@when('the cashier creates an order with cash "30.00" tendered "30.00" and bank transfer "20.00"')
def cashier_creates_split_order(split_context):
    r = split_context["client"].post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "bdd-split-order"},
        json={
            "items": [{"product_id": split_context["product"]["id"], "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
                {"method": "bank_transfer", "amount": "20.00"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    assert len(r.json()["payments"]) == 2
    split_context["order"] = r.json()


@then(parsers.parse('the order total is "{total}"'))
def order_total_is(split_context, total):
    assert split_context["order"]["total_amount"] == total


@then(parsers.parse('the cash payment shows change due "{change}"'))
def cash_payment_change_due(split_context, change):
    cash = next(p for p in split_context["order"]["payments"] if p["method"] == "cash")
    assert cash["change_due_amount"] == change


@then(parsers.parse('the bank transfer payment shows change due "{change}"'))
def bank_transfer_change_due(split_context, change):
    transfer = next(p for p in split_context["order"]["payments"] if p["method"] == "bank_transfer")
    assert transfer["change_due_amount"] == change


@when("the cashier creates an order with payments summing to \"49.00\"")
def cashier_creates_order_with_mismatched_payments(split_context):
    r = split_context["client"].post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "bdd-split-mismatch-order"},
        json={
            "items": [{"product_id": split_context["product"]["id"], "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
                {"method": "bank_transfer", "amount": "19.00"},
            ],
        },
    )
    split_context["error_response"] = r


@then("the order is rejected with payment mismatch error")
def order_rejected_with_payment_mismatch(split_context):
    assert split_context["error_response"].status_code == 400

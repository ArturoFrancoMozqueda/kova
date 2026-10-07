from uuid import uuid4

import pytest
from pytest_bdd import given, scenario, then, when

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


@scenario("../../../../specs/orders/offline_sync.feature", "Queued offline sale syncs into an order")
def test_queued_offline_sale_syncs_into_order():
    pass


@scenario(
    "../../../../specs/orders/offline_sync.feature",
    "Replaying an offline sale does not duplicate the order",
)
def test_replaying_offline_sale_does_not_duplicate_order():
    pass


@scenario("../../../../specs/orders/offline_sync.feature", "Invalid queued sale becomes a dead letter")
def test_invalid_queued_sale_becomes_dead_letter():
    pass


def _signup_verify_login(client, email: str, tenant_name: str) -> dict:
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
    return signup


@given("an active catalog product for offline sync", target_fixture="offline_context")
def active_catalog_product(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"offline-bdd-{suffix}@example.com", "Offline BDD Bakery")
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"offline-bdd-product-{suffix}"},
        json={"name": "Offline Concha", "price_amount": "18.50"},
    )
    assert product.status_code == 201, product.text
    return {"client": client, "product": product.json(), "client_uuid": str(uuid4())}


@given("a verified cashier with a queued offline cash sale")
def queued_offline_cash_sale(offline_context):
    offline_context["sale"] = {
        "client_uuid": offline_context["client_uuid"],
        "order": {
            "items": [{"product_id": offline_context["product"]["id"], "quantity": 2}],
            "payments": [
                {"method": "cash", "amount": "37.00", "amount_tendered": "40.00"}
            ],
        },
    }


@when("the cashier syncs offline sales")
def cashier_syncs_offline_sales(offline_context):
    response = offline_context["client"].post(
        "/api/v1/sync/offline-sales",
        json={"sales": [offline_context["sale"]]},
    )
    assert response.status_code == 200, response.text
    offline_context["sync_response"] = response.json()


@then("the queued sale is synced with an order id")
def queued_sale_synced(offline_context):
    result = offline_context["sync_response"]["results"][0]
    assert result["status"] == "synced"
    assert result["order_id"]


@when("the cashier syncs offline sales twice")
def cashier_syncs_offline_sales_twice(offline_context):
    cashier_syncs_offline_sales(offline_context)
    first = offline_context["sync_response"]
    cashier_syncs_offline_sales(offline_context)
    offline_context["first_sync_response"] = first


@then("both sync attempts return the same order id")
def both_sync_attempts_same_order(offline_context):
    first = offline_context["first_sync_response"]["results"][0]
    second = offline_context["sync_response"]["results"][0]
    assert first["order_id"] == second["order_id"]


@given("a verified cashier with an invalid queued offline sale", target_fixture="offline_context")
def verified_cashier_invalid_sale(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"offline-invalid-bdd-{suffix}@example.com", "Invalid Offline")
    return {
        "client": client,
        "sale": {
            "client_uuid": str(uuid4()),
            "order": {
                "items": [{"product_id": str(uuid4()), "quantity": 1}],
                "payments": [
                    {"method": "cash", "amount": "18.50", "amount_tendered": "20.00"}
                ],
            },
        },
    }


@then("the queued sale fails with a recoverable error")
def queued_sale_fails(offline_context):
    result = offline_context["sync_response"]["results"][0]
    assert result["status"] == "failed"
    assert result["error"]

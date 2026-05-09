from uuid import uuid4

from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenario, then, when

from app.main import app


@scenario("../../../../specs/orders/online_sale.feature", "Cashier completes a cash sale")
def test_cashier_completes_cash_sale():
    pass


@scenario("../../../../specs/orders/online_sale.feature", "Cashier records a bank transfer sale")
def test_cashier_records_bank_transfer_sale():
    pass


@scenario("../../../../specs/orders/online_sale.feature", "Tenants cannot read each other's orders")
def test_tenants_cannot_read_each_others_orders():
    pass


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
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


@given(
    parsers.parse('an active catalog product named "{product_name}" priced at "{price}"'),
    target_fixture="sale_context",
)
def active_catalog_product(client, product_name, price):
    _signup_verify_login(client, f"{product_name.lower()}-owner@example.com", f"{product_name} Bakery")
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"bdd-product-{product_name}"},
        json={"name": product_name, "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return {"client": client, "product": response.json()}


@given("a verified cashier for online sales")
def verified_cashier_for_online_sales(sale_context):
    # The current logged-in owner has orders.create and behaves as the sale actor for Sprint 2.
    assert sale_context["client"].get("/api/v1/auth/me").status_code == 200


@when(parsers.parse('the cashier creates a cash sale for {quantity:d} units with "{tendered}" tendered'))
def cashier_creates_cash_sale(sale_context, quantity, tendered):
    total = "37.00"
    response = sale_context["client"].post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "bdd-cash-sale"},
        json={
            "items": [{"product_id": sale_context["product"]["id"], "quantity": quantity}],
            "payments": [{"method": "cash", "amount": total, "amount_tendered": tendered}],
        },
    )
    assert response.status_code == 201, response.text
    sale_context["order"] = response.json()


@then(parsers.parse('the sale is completed with total "{total}"'))
def sale_completed_with_total(sale_context, total):
    assert sale_context["order"]["status"] == "completed"
    assert sale_context["order"]["total_amount"] == total


@then(parsers.parse('the cash change due is "{change_due}"'))
def cash_change_due(sale_context, change_due):
    assert sale_context["order"]["payments"][0]["change_due_amount"] == change_due


@when("the cashier creates a bank transfer sale for 1 unit")
def cashier_creates_bank_transfer_sale(sale_context):
    response = sale_context["client"].post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "bdd-transfer-sale"},
        json={
            "items": [{"product_id": sale_context["product"]["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": sale_context["product"]["price_amount"]}],
        },
    )
    assert response.status_code == 201, response.text
    sale_context["order"] = response.json()


@given("two tenants with completed online sales", target_fixture="isolation_context")
def two_tenants_with_completed_online_sales():
    client_a = TestClient(app)
    client_b = TestClient(app)
    suffix = uuid4().hex
    _signup_verify_login(client_a, f"sale-a-{suffix}@example.com", "Sale Tenant A")
    _signup_verify_login(client_b, f"sale-b-{suffix}@example.com", "Sale Tenant B")
    product = client_a.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bdd-isolation-sale-product"},
        json={"name": "Tenant A Concha", "price_amount": "18.50"},
    )
    assert product.status_code == 201, product.text
    order = client_a.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "bdd-isolation-sale"},
        json={
            "items": [{"product_id": product.json()["id"], "quantity": 1}],
            "payments": [{"method": "cash", "amount": "18.50", "amount_tendered": "20.00"}],
        },
    )
    assert order.status_code == 201, order.text
    return {"client_b": client_b, "order_id": order.json()["id"]}


@then("the second tenant cannot read the first tenant order")
def second_tenant_cannot_read_first_order(isolation_context):
    response = isolation_context["client_b"].get(f"/api/v1/orders/{isolation_context['order_id']}")
    assert response.status_code == 404

from decimal import Decimal
from uuid import UUID, uuid4

from pytest_bdd import given, scenario, then, when

from app.auth.models import Membership


@scenario("../../../../specs/reports/reports.feature", "Manager views a sales range summary")
def test_manager_views_sales_range_summary():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views payment method totals")
def test_manager_views_payment_method_totals():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views top products")
def test_manager_views_top_products():
    pass


@scenario(
    "../../../../specs/reports/reports.feature",
    "Permission denied without reports view permission",
)
def test_permission_denied_without_reports_permission():
    pass


@scenario(
    "../../../../specs/reports/reports.feature",
    "Tenant isolation: cannot see another tenant's reports",
)
def test_tenant_isolation_reports():
    pass


def _signup_verify_login(client, email: str, tenant_name: str) -> dict:
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


def _set_role(db, signup: dict, role: str) -> None:
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = role
    db.commit()


def _create_product(client, *, name: str, price: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"reports-product-{uuid4().hex}"},
        json={"name": name, "price_amount": price, "track_inventory": True},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_order(
    client,
    *,
    product: dict,
    quantity: int,
    payments: list[dict],
) -> dict:
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"reports-order-{uuid4().hex}"},
        json={
            "items": [{"product_id": product["id"], "quantity": quantity}],
            "payments": payments,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _cash_payment(amount: str) -> dict:
    return {"method": "cash", "amount": amount, "amount_tendered": amount}


@given("an authenticated manager with completed sales and a refund", target_fixture="reports_context")
def manager_with_sales_and_refund(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-manager-{suffix}@example.com", "Reports Tenant")
    product = _create_product(client, name="Concha", price="25.00")
    order = _create_order(client, product=product, quantity=2, payments=[_cash_payment("50.00")])
    refund = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"reports-refund-{suffix}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
        },
    )
    assert refund.status_code == 201, refund.text
    return {"client": client, "product": product, "order": order}


@given("an authenticated manager with split payment sales", target_fixture="reports_context")
def manager_with_split_payment_sales(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-split-{suffix}@example.com", "Reports Split Tenant")
    product = _create_product(client, name="Cake", price="50.00")
    _create_order(
        client,
        product=product,
        quantity=1,
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00", "reference": "SPEI-1"},
        ],
    )
    return {"client": client, "product": product}


@given("an authenticated manager with completed sales", target_fixture="reports_context")
def manager_with_completed_sales(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-top-{suffix}@example.com", "Reports Top Tenant")
    concha = _create_product(client, name="Concha", price="25.00")
    roll = _create_product(client, name="Roll", price="10.00")
    _create_order(client, product=concha, quantity=3, payments=[_cash_payment("75.00")])
    _create_order(client, product=roll, quantity=1, payments=[_cash_payment("10.00")])
    return {"client": client, "concha": concha, "roll": roll}


@given("an authenticated cashier without reports permission", target_fixture="reports_context")
def cashier_without_reports_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"reports-cashier-{suffix}@example.com", "Reports Cashier")
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"reports-cashier-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client}


@given("tenant A has completed sales", target_fixture="reports_context")
def tenant_a_has_completed_sales(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-tenant-a-{suffix}@example.com", "Reports Tenant A")
    product = _create_product(client, name="Tenant A Product", price="40.00")
    _create_order(client, product=product, quantity=1, payments=[_cash_payment("40.00")])
    client.post("/api/v1/auth/logout")
    _signup_verify_login(client, f"reports-tenant-b-{suffix}@example.com", "Reports Tenant B")
    return {"client": client}


@when("the manager requests the sales summary report")
def manager_requests_sales_summary(reports_context):
    response = reports_context["client"].get("/api/v1/reports/sales-summary")
    reports_context["response"] = response
    reports_context["summary"] = response.json() if response.status_code == 200 else None


@when("the manager requests the payment breakdown report")
def manager_requests_payment_breakdown(reports_context):
    response = reports_context["client"].get("/api/v1/reports/payment-breakdown")
    reports_context["response"] = response
    reports_context["payments"] = response.json() if response.status_code == 200 else None


@when("the manager requests the top products report")
def manager_requests_top_products(reports_context):
    response = reports_context["client"].get("/api/v1/reports/top-products")
    reports_context["response"] = response
    reports_context["top_products"] = response.json() if response.status_code == 200 else None


@when("the cashier requests the sales summary report")
def cashier_requests_sales_summary(reports_context):
    manager_requests_sales_summary(reports_context)


@when("tenant B requests the sales summary report")
def tenant_b_requests_sales_summary(reports_context):
    manager_requests_sales_summary(reports_context)


@then("gross sales, refunds, and net sales are calculated correctly")
def summary_calculated_correctly(reports_context):
    summary = reports_context["summary"]
    assert Decimal(summary["gross_sales"]) == Decimal("50.00")
    assert Decimal(summary["refund_total"]) == Decimal("25.00")
    assert Decimal(summary["net_sales"]) == Decimal("25.00")
    assert summary["order_count"] == 1
    assert summary["refund_count"] == 1


@then("payment totals are grouped by method")
def payment_totals_grouped_by_method(reports_context):
    rows = {row["method"]: row for row in reports_context["payments"]["payments"]}
    assert Decimal(rows["cash"]["amount"]) == Decimal("30.00")
    assert Decimal(rows["bank_transfer"]["amount"]) == Decimal("20.00")
    assert rows["cash"]["payment_count"] == 1
    assert rows["bank_transfer"]["payment_count"] == 1


@then("products are sorted by quantity sold")
def products_sorted_by_quantity_sold(reports_context):
    products = reports_context["top_products"]["products"]
    assert products[0]["product_name"] == "Concha"
    assert products[0]["quantity_sold"] == 3
    assert products[1]["product_name"] == "Roll"


@then("a 403 error is returned")
def error_403_returned(reports_context):
    assert reports_context["response"].status_code == 403


@then("tenant A's sales are not included")
def tenant_a_sales_not_included(reports_context):
    summary = reports_context["summary"]
    assert Decimal(summary["gross_sales"]) == Decimal("0.00")
    assert summary["order_count"] == 0

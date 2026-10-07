from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from pytest_bdd import given, scenario, then, when

from app.auth.models import Membership, User
from app.orders.models import Order, Refund

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


@scenario("../../../../specs/reports/reports.feature", "Manager views a sales range summary")
def test_manager_views_sales_range_summary():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views payment method totals")
def test_manager_views_payment_method_totals():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views top products")
def test_manager_views_top_products():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views hourly sales trend")
def test_manager_views_hourly_sales_trend():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views employee sales performance")
def test_manager_views_employee_sales_performance():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views refund reasons")
def test_manager_views_refund_reasons():
    pass


@scenario(
    "../../../../specs/reports/reports.feature",
    "Refund after sale stays attributed to sale cohort",
)
def test_refund_after_sale_stays_attributed_to_sale_cohort():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views the business story report")
def test_manager_views_business_story_report():
    pass


@scenario("../../../../specs/reports/reports.feature", "Manager views an empty business story report")
def test_manager_views_empty_business_story_report():
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


def _set_order_hour(db, order_id: str, hour: int) -> None:
    """Pin an order's sale time to the given hour in the tenant timezone.

    Reports bucket by occurred_at (the client ring-time), so pin both it and
    created_at to keep the simulated sale coherent.
    """
    order = db.query(Order).filter(Order.id == UUID(order_id)).one()
    tz = ZoneInfo("America/Mexico_City")
    local_today = datetime.now(tz).replace(hour=hour, minute=0, second=0, microsecond=0)
    order.created_at = local_today.astimezone(UTC)
    order.occurred_at = local_today.astimezone(UTC)
    db.commit()


def _set_order_created_at(db, order_id: str, value: datetime) -> None:
    order = db.query(Order).filter(Order.id == UUID(order_id)).one()
    order.created_at = value
    order.updated_at = value
    # Reports key off occurred_at now; keep it aligned with the pinned time.
    order.occurred_at = value
    db.commit()


def _set_void_created_at(db, order_id: str, value: datetime) -> None:
    from app.orders.models import Void

    void = db.query(Void).filter(Void.order_id == UUID(order_id)).one()
    void.created_at = value
    db.commit()


def _create_user(db, *, tenant_id: str, email: str, role: str = "cashier") -> User:
    user = User(
        email=email,
        hashed_password="unused",
        is_email_verified=True,
        is_active=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    db.add(
        Membership(
            tenant_id=UUID(tenant_id),
            user_id=user.id,
            role=role,
            is_active=True,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    return user


def _set_order_user(db, order_id: str, user_id: UUID) -> None:
    order = db.query(Order).filter(Order.id == UUID(order_id)).one()
    order.created_by_user_id = user_id
    db.commit()


def _open_shift(client) -> dict:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"reports-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_product(client, *, name: str, price: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"reports-product-{uuid4().hex}"},
        json={"name": name, "price_amount": price, "track_inventory": True},
    )
    assert response.status_code == 201, response.text
    product = response.json()
    # Seed enough stock for downstream sales to pass the OUT_OF_STOCK guard
    # (Sprint 5 BUG-002). 1000 units is plenty for any report scenario.
    seed = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        headers={"Idempotency-Key": f"reports-seed-{uuid4().hex}"},
        json={"quantity_delta": 1000, "reason": "Seed stock for test"},
    )
    assert seed.status_code == 201, seed.text
    return product


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
    _open_shift(client)
    product = _create_product(client, name="Concha", price="25.00")
    order = _create_order(client, product=product, quantity=2, payments=[_cash_payment("50.00")])
    refund = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"reports-refund-{suffix}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund.status_code == 201, refund.text
    return {"client": client, "product": product, "order": order}


@given("an authenticated manager with split payment sales", target_fixture="reports_context")
def manager_with_split_payment_sales(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-split-{suffix}@example.com", "Reports Split Tenant")
    _open_shift(client)
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
    _open_shift(client)
    concha = _create_product(client, name="Concha", price="25.00")
    roll = _create_product(client, name="Roll", price="10.00")
    _create_order(client, product=concha, quantity=3, payments=[_cash_payment("75.00")])
    _create_order(client, product=roll, quantity=1, payments=[_cash_payment("10.00")])
    return {"client": client, "concha": concha, "roll": roll}


@given("an authenticated manager with sales in different hours", target_fixture="reports_context")
def manager_with_hourly_sales(client, db):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-hourly-{suffix}@example.com", "Reports Hourly Tenant")
    _open_shift(client)
    concha = _create_product(client, name="Concha", price="25.00")
    coffee = _create_product(client, name="Coffee", price="30.00")
    morning = _create_order(client, product=concha, quantity=1, payments=[_cash_payment("25.00")])
    lunch = _create_order(client, product=coffee, quantity=2, payments=[_cash_payment("60.00")])
    _set_order_hour(db, morning["id"], 9)
    _set_order_hour(db, lunch["id"], 13)
    return {"client": client}


@given("an authenticated manager with sales from multiple employees", target_fixture="reports_context")
def manager_with_employee_sales(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(
        client, f"reports-employees-owner-{suffix}@example.com", "Reports Employee Tenant"
    )
    _open_shift(client)
    employee = _create_user(
        db,
        tenant_id=signup["tenant_id"],
        email=f"cashier-{suffix}@example.com",
    )
    concha = _create_product(client, name="Concha", price="25.00")
    owner_order = _create_order(client, product=concha, quantity=1, payments=[_cash_payment("25.00")])
    employee_order = _create_order(
        client, product=concha, quantity=2, payments=[_cash_payment("50.00")]
    )
    _set_order_user(db, employee_order["id"], employee.id)
    refund = client.post(
        f"/api/v1/orders/{employee_order['id']}/refunds",
        headers={"Idempotency-Key": f"reports-employee-refund-{suffix}"},
        json={
            "items": [{"order_item_id": employee_order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert refund.status_code == 201, refund.text
    return {
        "client": client,
        "owner_user_id": signup["user_id"],
        "employee_user_id": str(employee.id),
        "owner_order_id": owner_order["id"],
    }


@given("an authenticated manager with refunds for different reasons", target_fixture="reports_context")
def manager_with_refund_reasons(client):
    suffix = uuid4().hex
    _signup_verify_login(
        client, f"reports-refund-reasons-{suffix}@example.com", "Reports Refund Tenant"
    )
    _open_shift(client)
    concha = _create_product(client, name="Concha", price="25.00")
    roll = _create_product(client, name="Roll", price="10.00")
    order_a = _create_order(client, product=concha, quantity=2, payments=[_cash_payment("50.00")])
    order_b = _create_order(client, product=roll, quantity=1, payments=[_cash_payment("10.00")])
    refund_a = client.post(
        f"/api/v1/orders/{order_a['id']}/refunds",
        headers={"Idempotency-Key": f"reports-reason-a-{suffix}"},
        json={
            "items": [{"order_item_id": order_a["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    refund_b = client.post(
        f"/api/v1/orders/{order_b['id']}/refunds",
        headers={"Idempotency-Key": f"reports-reason-b-{suffix}"},
        json={
            "items": [{"order_item_id": order_b["items"][0]["id"], "quantity": 1}],
            "reason": "defective",
            "refund_payment_method": "cash",
        },
    )
    assert refund_a.status_code == 201, refund_a.text
    assert refund_b.status_code == 201, refund_b.text
    return {"client": client}


@given(
    "an authenticated manager with a sale and its refund on consecutive local dates",
    target_fixture="reports_context",
)
def manager_with_cross_period_refund(client, db):
    suffix = uuid4().hex
    _signup_verify_login(
        client, f"reports-cohort-{suffix}@example.com", "Reports Cohort Tenant"
    )
    _open_shift(client)
    product = _create_product(client, name="Venta de cohorte", price="100.00")
    order = _create_order(
        client,
        product=product,
        quantity=1,
        payments=[_cash_payment("100.00")],
    )
    tz = ZoneInfo("America/Mexico_City")
    sale_day = datetime.now(tz).date() - timedelta(days=3)
    refund_day = sale_day + timedelta(days=1)
    sale_at = datetime.combine(sale_day, datetime.min.time(), tzinfo=tz) + timedelta(
        hours=23, minutes=50
    )
    _set_order_created_at(db, order["id"], sale_at.astimezone(UTC))
    response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"reports-cohort-refund-{suffix}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert response.status_code == 201, response.text
    refund = db.get(Refund, UUID(response.json()["id"]))
    assert refund is not None
    refund.created_at = datetime.combine(
        refund_day, datetime.min.time(), tzinfo=tz
    ).astimezone(UTC) + timedelta(minutes=10)
    db.commit()
    return {
        "client": client,
        "sale_day": sale_day.isoformat(),
        "refund_day": refund_day.isoformat(),
    }


@given(
    "an authenticated manager with sales across days, dayparts, products, payments, and corrections",
    target_fixture="reports_context",
)
def manager_with_business_story_data(client, db):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-story-{suffix}@example.com", "Reports Story Tenant")
    _open_shift(client)
    dona = _create_product(client, name="Dona", price="10.00")
    concha = _create_product(client, name="Concha", price="20.00")
    tenant_tz = ZoneInfo("America/Mexico_City")
    today = datetime.now(tenant_tz).replace(minute=0, second=0, microsecond=0)
    yesterday = today - timedelta(days=1)

    night_order = _create_order(
        client,
        product=dona,
        quantity=5,
        payments=[_cash_payment("50.00")],
    )
    later_night_order = _create_order(
        client,
        product=concha,
        quantity=2,
        payments=[{"method": "bank_transfer", "amount": "40.00", "reference": "SPEI"}],
    )
    void_order = _create_order(
        client,
        product=concha,
        quantity=1,
        payments=[_cash_payment("20.00")],
    )

    _set_order_created_at(db, night_order["id"], yesterday.replace(hour=20).astimezone(UTC))
    _set_order_created_at(
        db, later_night_order["id"], today.replace(hour=21).astimezone(UTC)
    )
    _set_order_created_at(db, void_order["id"], today.replace(hour=10).astimezone(UTC))

    refund = client.post(
        f"/api/v1/orders/{later_night_order['id']}/refunds",
        headers={"Idempotency-Key": f"reports-story-refund-{suffix}"},
        json={
            "items": [{"order_item_id": later_night_order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "bank_transfer",
        },
    )
    assert refund.status_code == 201, refund.text
    void_response = client.post(
        f"/api/v1/orders/{void_order['id']}/void",
        headers={"Idempotency-Key": f"reports-story-void-{suffix}"},
        json={"reason": "operator_error"},
    )
    assert void_response.status_code == 201, void_response.text
    _set_void_created_at(db, void_order["id"], today.replace(hour=10).astimezone(UTC))

    return {
        "client": client,
        "start": yesterday.date().isoformat(),
        "end": today.date().isoformat(),
    }


@given("an authenticated manager without completed sales", target_fixture="reports_context")
def manager_without_completed_sales(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"reports-empty-story-{suffix}@example.com", "Reports Empty Tenant")
    return {"client": client}


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
    _open_shift(client)
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


@when("the manager requests the hourly sales report")
def manager_requests_hourly_sales(reports_context):
    response = reports_context["client"].get("/api/v1/reports/sales-by-hour")
    reports_context["response"] = response
    reports_context["sales_by_hour"] = response.json() if response.status_code == 200 else None


@when("the manager requests the employee sales report")
def manager_requests_employee_sales(reports_context):
    response = reports_context["client"].get("/api/v1/reports/sales-by-employee")
    reports_context["response"] = response
    reports_context["sales_by_employee"] = response.json() if response.status_code == 200 else None


@when("the manager requests the refund reason report")
def manager_requests_refund_reasons(reports_context):
    response = reports_context["client"].get("/api/v1/reports/refunds-by-reason")
    reports_context["response"] = response
    reports_context["refunds_by_reason"] = response.json() if response.status_code == 200 else None


@when("the manager compares sale-day and refund-day report windows")
def manager_compares_cross_period_refund(reports_context):
    client = reports_context["client"]
    sale_day = reports_context["sale_day"]
    refund_day = reports_context["refund_day"]

    def get(path: str, day: str):
        response = client.get(f"{path}?start_date={day}&end_date={day}")
        assert response.status_code == 200, response.text
        return response.json()

    reports_context["sale_summary"] = get("/api/v1/reports/sales-summary", sale_day)
    reports_context["sale_reasons"] = get("/api/v1/reports/refunds-by-reason", sale_day)
    reports_context["refund_summary"] = get(
        "/api/v1/reports/sales-summary", refund_day
    )
    reports_context["refund_reasons"] = get(
        "/api/v1/reports/refunds-by-reason", refund_day
    )


@when("the manager requests the business story report")
def manager_requests_business_story(reports_context):
    query = ""
    if "start" in reports_context and "end" in reports_context:
        query = f"?start={reports_context['start']}&end={reports_context['end']}"
    response = reports_context["client"].get(f"/api/v1/reports/business-story{query}")
    reports_context["response"] = response
    reports_context["business_story"] = response.json() if response.status_code == 200 else None


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


@then("sales are grouped into 24 hourly buckets")
def sales_grouped_into_hourly_buckets(reports_context):
    rows = reports_context["sales_by_hour"]
    assert len(rows) == 24
    by_hour = {row["hour"]: row for row in rows}
    assert Decimal(by_hour[9]["net_sales"]) == Decimal("25.00")
    assert by_hour[9]["order_count"] == 1
    assert Decimal(by_hour[13]["net_sales"]) == Decimal("60.00")
    assert by_hour[13]["order_count"] == 1
    assert Decimal(by_hour[0]["net_sales"]) == Decimal("0.00")


@then("sales are grouped by employee with refund counts")
def sales_grouped_by_employee(reports_context):
    rows = {
        row["user_id"]: row
        for row in reports_context["sales_by_employee"]
    }
    owner = rows[reports_context["owner_user_id"]]
    employee = rows[reports_context["employee_user_id"]]
    assert owner["order_count"] == 1
    assert Decimal(owner["net_sales"]) == Decimal("25.00")
    assert owner["refund_count"] == 0
    assert employee["order_count"] == 1
    assert Decimal(employee["net_sales"]) == Decimal("25.00")
    assert employee["refund_count"] == 1


@then("refunds are grouped by reason")
def refunds_grouped_by_reason(reports_context):
    rows = {row["reason"]: row for row in reports_context["refunds_by_reason"]}
    assert rows["customer_return"]["refund_count"] == 1
    assert Decimal(rows["customer_return"]["refunded_amount"]) == Decimal("25.00")
    assert rows["defective"]["refund_count"] == 1
    assert Decimal(rows["defective"]["refunded_amount"]) == Decimal("10.00")


@then("refund totals and reasons reconcile to the original sale date")
def cross_period_refund_reconciles(reports_context):
    sale_summary = reports_context["sale_summary"]
    assert Decimal(sale_summary["gross_sales"]) == Decimal("100.00")
    assert Decimal(sale_summary["refund_total"]) == Decimal("100.00")
    assert Decimal(sale_summary["net_sales"]) == Decimal("0.00")
    assert sale_summary["refund_count"] == 1
    assert reports_context["sale_reasons"] == [
        {
            "reason": "customer_return",
            "refund_count": 1,
            "refunded_amount": "100.00",
        }
    ]
    assert Decimal(reports_context["refund_summary"]["gross_sales"]) == Decimal(
        "0.00"
    )
    assert Decimal(reports_context["refund_summary"]["refund_total"]) == Decimal(
        "0.00"
    )
    assert reports_context["refund_reasons"] == []


@then(
    "daily sales, daypart sales, peak hour, product share, payment share, and recommended actions are calculated from real data"
)
def business_story_calculated_from_real_data(reports_context):
    story = reports_context["business_story"]
    assert story["summary"]["completed_orders"] == 2
    assert Decimal(story["summary"]["gross_sales"]) == Decimal("90.00")
    assert Decimal(story["summary"]["refund_total"]) == Decimal("20.00")
    assert Decimal(story["summary"]["net_sales"]) == Decimal("70.00")
    assert story["summary"]["refund_count"] == 1
    assert story["summary"]["cancellation_count"] == 1

    days = {row["date"]: row for row in story["sales_by_day"]}
    assert len(days) == 2
    assert sum(row["order_count"] for row in days.values()) == 2

    dayparts = {row["key"]: row for row in story["sales_by_daypart"]}
    assert Decimal(dayparts["noche"]["net_sales"]) == Decimal("70.00")
    assert dayparts["noche"]["order_count"] == 2
    assert dayparts["noche"]["sales_share_pct"] == 100
    assert Decimal(dayparts["manana"]["net_sales"]) == Decimal("0.00")

    assert story["peak_hour"]["hour"] == 20
    assert story["peak_hour"]["daypart_key"] == "noche"
    assert Decimal(story["peak_hour"]["net_sales"]) == Decimal("50.00")
    assert story["top_product_by_sales"]["product_name"] == "Dona"
    # Product share excludes refunded items (Dona $50 of $70 net product sales);
    # Concha's refunded unit is subtracted, so 50/70 = 71% rather than 50/90.
    assert story["top_product_by_sales"]["sales_share_pct"] == 71
    assert story["top_product_by_units"]["product_name"] == "Dona"
    assert story["dominant_payment"]["method"] == "cash"
    assert story["dominant_payment"]["sales_share_pct"] == 56
    assert any(action["type"] == "risk" for action in story["recommended_actions"])
    assert "demo" not in story["executive_summary"].lower()


@then("the report returns empty-state guidance without demo insights")
def business_story_empty_state(reports_context):
    story = reports_context["business_story"]
    assert story["summary"]["completed_orders"] == 0
    assert Decimal(story["summary"]["net_sales"]) == Decimal("0.00")
    assert story["sales_by_day"] == []
    assert story["peak_hour"] is None
    assert story["top_product_by_sales"] is None
    assert story["dominant_payment"] is None
    assert story["recommended_actions"][0]["type"] == "opportunity"
    assert "demo" not in story["executive_summary"].lower()


@then("a 403 error is returned")
def error_403_returned(reports_context):
    assert reports_context["response"].status_code == 403


@then("tenant A's sales are not included")
def tenant_a_sales_not_included(reports_context):
    summary = reports_context["summary"]
    assert Decimal(summary["gross_sales"]) == Decimal("0.00")
    assert summary["order_count"] == 0

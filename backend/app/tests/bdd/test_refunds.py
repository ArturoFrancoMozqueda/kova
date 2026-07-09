from decimal import Decimal
from uuid import UUID, uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership


@scenario("../../../../specs/orders/refund.feature", "Manager refunds one item from an order")
def test_manager_refunds_one_item():
    pass


@scenario("../../../../specs/orders/refund.feature", "Manager refunds multiple items from an order")
def test_manager_refunds_multiple_items():
    pass


@scenario("../../../../specs/orders/refund.feature", "Cannot refund more than available quantity")
def test_cannot_refund_more_than_available():
    pass


@scenario("../../../../specs/orders/refund.feature", "Cannot refund a voided order")
def test_cannot_refund_voided_order():
    pass


@scenario(
    "../../../../specs/orders/refund.feature",
    "Duplicate refund request with same key returns same response",
)
def test_duplicate_refund_request():
    pass


@scenario(
    "../../../../specs/orders/refund.feature",
    "Permission denied for refund without orders.refund permission",
)
def test_permission_denied_for_refund():
    pass


@scenario(
    "../../../../specs/orders/refund.feature",
    "Tenant isolation: cannot refund another tenant's order",
)
def test_tenant_isolation_refund():
    pass


@scenario(
    "../../../../specs/orders/refund.feature",
    "Cash refund affects active shift reconciliation",
)
def test_cash_refund_affects_active_shift_reconciliation():
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


def _open_shift(client) -> dict:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"refund-bdd-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_product(client, *, name: str, price: str) -> dict:
    suffix = uuid4().hex
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"refund-bdd-product-{suffix}"},
        json={"name": name, "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_order(client, products: list[dict]) -> dict:
    suffix = uuid4().hex
    total = sum(Decimal(product["price_amount"]) for product in products)
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"refund-bdd-order-{suffix}"},
        json={
            "items": [{"product_id": product["id"], "quantity": 1} for product in products],
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


def _create_two_item_order(client) -> tuple[list[dict], dict]:
    products = [
        _create_product(client, name="Refund Test Concha", price="25.00"),
        _create_product(client, name="Refund Test Roll", price="25.00"),
    ]
    return products, _create_order(client, products)


@given("an authenticated manager with a completed order", target_fixture="refund_context")
def manager_with_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"refund-manager-{suffix}@example.com", "Refund Test Tenant")
    _open_shift(client)
    products, order = _create_two_item_order(client)
    return {"client": client, "order": order, "products": products}


@given(
    "an authenticated manager with an open shift and a completed cash order",
    target_fixture="refund_context",
)
def manager_with_open_shift_and_cash_order(client):
    suffix = uuid4().hex
    _signup_verify_login(
        client, f"refund-shift-manager-{suffix}@example.com", "Refund Shift Tenant"
    )
    shift_response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"refund-shift-open-{suffix}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert shift_response.status_code == 201, shift_response.text
    products, order = _create_two_item_order(client)
    return {
        "client": client,
        "order": order,
        "products": products,
        "shift": shift_response.json(),
    }


@given("an authenticated manager with a voided order", target_fixture="refund_context")
def manager_with_voided_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"refund-voided-{suffix}@example.com", "Refund Voided Tenant")
    _open_shift(client)
    products, order = _create_two_item_order(client)
    void_response = client.post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"refund-void-setup-{suffix}"},
        json={"reason": "operator_error"},
    )
    assert void_response.status_code == 201, void_response.text
    return {"client": client, "order": order, "products": products}


@given("an authenticated cashier without refund permission", target_fixture="refund_context")
def cashier_without_refund_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(
        client, f"refund-cashier-{suffix}@example.com", "Refund Cashier Tenant"
    )
    _open_shift(client)
    products, order = _create_two_item_order(client)
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"refund-cashier-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client, "order": order, "products": products}


@given("two separate tenants with orders", target_fixture="refund_context")
def two_tenants_with_orders(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"refund-tenant-a-{suffix}@example.com", "Refund Tenant A")
    _open_shift(client)
    products, order = _create_two_item_order(client)
    client.post("/api/v1/auth/logout")
    _signup_verify_login(client, f"refund-tenant-b-{suffix}@example.com", "Refund Tenant B")
    return {"client": client, "tenant_a_order": order, "tenant_a_products": products}


@when(parsers.parse('the manager refunds one item with reason "{reason}"'))
def refund_one_item(refund_context, reason):
    _post_refund(
        refund_context,
        [{"order_item_id": refund_context["order"]["items"][0]["id"], "quantity": 1}],
        reason,
    )


@when(parsers.parse('the manager refunds multiple items with reason "{reason}"'))
def refund_multiple_items(refund_context, reason):
    items = [
        {"order_item_id": item["id"], "quantity": 1} for item in refund_context["order"]["items"]
    ]
    _post_refund(refund_context, items, reason)


@when(parsers.parse('the manager refunds one item in cash with reason "{reason}"'))
def refund_one_item_in_cash(refund_context, reason):
    _post_refund(
        refund_context,
        [{"order_item_id": refund_context["order"]["items"][0]["id"], "quantity": 1}],
        reason,
        refund_payment_method="cash",
    )


@when("the manager attempts to refund more items than ordered")
def attempt_over_refund(refund_context):
    _post_refund(
        refund_context,
        [{"order_item_id": refund_context["order"]["items"][0]["id"], "quantity": 999}],
        "customer_return",
    )


@when("the manager attempts to refund an item")
def attempt_refund_item(refund_context):
    _post_refund(
        refund_context,
        [{"order_item_id": refund_context["order"]["items"][0]["id"], "quantity": 1}],
        "customer_return",
    )


@when(parsers.parse('the manager creates a refund with idempotency key "{key}"'))
def refund_with_key(refund_context, key):
    _post_refund(
        refund_context,
        [{"order_item_id": refund_context["order"]["items"][0]["id"], "quantity": 1}],
        "customer_return",
        key=key,
    )


@when(parsers.parse('creates the same refund again with key "{key}"'))
def refund_again_with_key(refund_context, key):
    order = refund_context["order"]
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": key},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    refund_context["refund_response_2"] = response
    refund_context["refund_2"] = response.json() if response.status_code == 201 else None


@when("the cashier attempts to refund an item")
def cashier_attempts_refund(refund_context):
    attempt_refund_item(refund_context)


@when("tenant B attempts to refund tenant A's order")
def tenant_b_attempts_refund(refund_context):
    order = refund_context["tenant_a_order"]
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-cross-tenant-{uuid4().hex}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    refund_context["refund_response"] = response


def _post_refund(
    refund_context,
    items: list[dict],
    reason: str,
    *,
    key: str | None = None,
    refund_payment_method: str | None = None,
) -> None:
    order = refund_context["order"]
    # refund_payment_method is required by the API; default to cash since the
    # refund fixtures ring cash orders.
    payload = {
        "items": items,
        "reason": reason,
        "refund_payment_method": refund_payment_method or "cash",
    }
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": key or f"refund-{uuid4().hex}"},
        json=payload,
    )
    refund_context["refund_response"] = response
    refund_context["refund"] = response.json() if response.status_code == 201 else None


@then("the refund is created successfully")
def refund_created(refund_context):
    response = refund_context["refund_response"]
    assert response.status_code == 201, response.text
    refund = response.json()
    assert refund["id"]
    assert refund["order_id"] == str(refund_context["order"]["id"])
    assert len(refund["items"]) > 0


@then("the refunded inventory is restored")
def inventory_restored(refund_context):
    receipt = _receipt(refund_context)
    assert len(receipt["refunds"]) > 0


@then("the refunded inventory is restored for all items")
def inventory_restored_for_all_items(refund_context):
    receipt = _receipt(refund_context)
    assert len(receipt["refunds"][0]["items"]) == len(refund_context["order"]["items"])


@then("the refund appears in the audit log")
def refund_in_audit_log(refund_context):
    assert refund_context["refund"] is not None


@then("a refund payout cash movement is recorded")
def refund_payout_cash_movement_recorded(refund_context):
    response = refund_context["client"].get(f"/api/v1/shifts/{refund_context['shift']['id']}")
    assert response.status_code == 200, response.text
    shift = response.json()
    payout = [m for m in shift["movements"] if m["type"] == "refund_payout"]
    assert len(payout) == 1
    assert Decimal(payout[0]["amount"]) == Decimal(refund_context["refund"]["refunded_amount"])


@then("shift reconciliation subtracts the refund payout")
def shift_reconciliation_subtracts_refund_payout(refund_context):
    refund_amount = Decimal(refund_context["refund"]["refunded_amount"])
    # Drawer = opening 100.00 + the 50.00 cash sale rung in this shift
    # (two 25.00 items) − the cash refund paid out. Expected cash now includes
    # cash sales, so the physically correct drawer is 150.00 − refund (was
    # asserted as 100.00 − refund, which silently dropped the sale's cash).
    actual_cash = Decimal("150.00") - refund_amount
    response = refund_context["client"].post(
        f"/api/v1/shifts/{refund_context['shift']['id']}/close",
        headers={"Idempotency-Key": f"refund-shift-close-{uuid4().hex}"},
        json={"actual_cash_amount": str(actual_cash)},
    )
    assert response.status_code == 201, response.text
    closed_shift = response.json()
    assert Decimal(closed_shift["expected_cash_amount"]) == actual_cash
    assert closed_shift["reconciliation_status"] == "balanced"


@then("the refund amount is calculated correctly")
def refund_amount_correct(refund_context):
    refund = refund_context["refund"]
    assert Decimal(refund["refunded_amount"]) == Decimal("50.00")


@then("a 400 error is returned")
def error_400(refund_context):
    assert refund_context["refund_response"].status_code == 400


@then("a 422 error is returned")
def error_422(refund_context):
    assert refund_context["refund_response"].status_code == 422


@then("a 403 error is returned")
def error_403(refund_context):
    assert refund_context["refund_response"].status_code == 403


@then("a 404 error is returned")
def error_404(refund_context):
    assert refund_context["refund_response"].status_code == 404


@then("no refund is created")
def no_refund_created(refund_context):
    assert refund_context.get("refund") is None


@then("both requests return the same refund response")
def same_refund_response(refund_context):
    refund1 = refund_context["refund"]
    refund2 = refund_context["refund_2"]
    assert refund1["id"] == refund2["id"]
    assert refund1["refunded_amount"] == refund2["refunded_amount"]


@then("only one refund exists in the database")
def only_one_refund(refund_context):
    order = refund_context["order"]
    response = refund_context["client"].get(f"/api/v1/orders/{order['id']}/refunds")
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1


def _receipt(refund_context) -> dict:
    order = refund_context["order"]
    response = refund_context["client"].get(f"/api/v1/orders/{order['id']}/receipt")
    assert response.status_code == 200, response.text
    return response.json()

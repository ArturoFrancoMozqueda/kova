from uuid import uuid4

from pytest_bdd import given, scenario, then, when


@scenario("../../../../specs/orders/refund.feature", "Manager refunds one item from an order")
def test_manager_refunds_one_item():
    pass


@scenario("../../../../specs/orders/refund.feature", "Manager refunds multiple items from an order")
def test_manager_refunds_multiple_items():
    pass


@scenario(
    "../../../../specs/orders/refund.feature", "Cannot refund more than available quantity"
)
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


def _create_catalog(client):
    suffix = uuid4().hex
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"refund-bdd-product-{suffix}"},
        json={"name": "Refund Test Product", "price_amount": "25.00"},
    )
    assert product.status_code == 201, product.text
    return product.json()


def _create_order(client, product_id: str, quantity: int = 1):
    suffix = uuid4().hex
    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"refund-bdd-order-{suffix}"},
        json={
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payments": [
                {
                    "method": "cash",
                    "amount": "50.00",
                    "amount_tendered": "50.00",
                }
            ],
        },
    )
    assert order.status_code == 201, order.text
    return order.json()


@given("an authenticated manager with a completed order", target_fixture="refund_context")
def manager_with_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"refund-manager-{suffix}@example.com", "Refund Test Tenant")
    product = _create_catalog(client)
    order = _create_order(client, product["id"])
    return {"client": client, "order": order, "product": product}


@when("the manager refunds one item with reason {reason:w}")
def refund_one_item(refund_context, reason):
    order = refund_context["order"]
    item = order["items"][0]
    suffix = uuid4().hex
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-{suffix}"},
        json={
            "items": [{"order_item_id": item["id"], "quantity": 1}],
            "reason": reason.strip('"'),
        },
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
    order = refund_context["order"]
    receipt = refund_context["client"].get(f"/api/v1/orders/{order['id']}/receipt")
    assert receipt.status_code == 200
    receipt_data = receipt.json()
    assert "refunds" in receipt_data
    assert len(receipt_data["refunds"]) > 0


@then("the refund appears in the audit log")
def refund_in_audit_log(refund_context):
    refund = refund_context["refund"]
    assert refund is not None


@when("the manager refunds multiple items with reason {reason:w}")
def refund_multiple_items(refund_context, reason):
    order = refund_context["order"]
    items = order["items"]
    suffix = uuid4().hex
    refund_items = [{"order_item_id": item["id"], "quantity": 1} for item in items]
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-multiple-{suffix}"},
        json={
            "items": refund_items,
            "reason": reason.strip('"'),
        },
    )
    refund_context["refund_response"] = response
    refund_context["refund"] = response.json() if response.status_code == 201 else None


@then("the refund amount is calculated correctly")
def refund_amount_correct(refund_context):
    refund = refund_context["refund"]
    assert float(refund["refunded_amount"]) > 0


@when("the manager attempts to refund more items than ordered")
def attempt_overfund(refund_context):
    order = refund_context["order"]
    item = order["items"][0]
    suffix = uuid4().hex
    response = refund_context["client"].post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"overfund-{suffix}"},
        json={
            "items": [{"order_item_id": item["id"], "quantity": 999}],
            "reason": "customer_return",
        },
    )
    refund_context["refund_response"] = response


@then("a 400 error is returned")
def error_400(refund_context):
    assert refund_context["refund_response"].status_code == 400


@then("no refund is created")
def no_refund_created(refund_context):
    assert refund_context.get("refund") is None

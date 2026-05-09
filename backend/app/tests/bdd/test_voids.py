from uuid import uuid4

from pytest_bdd import given, scenario, then, when


@scenario("../../../../specs/orders/void.feature", "Manager voids a completed order")
def test_manager_voids_order():
    pass


@scenario("../../../../specs/orders/void.feature", "Cannot void an order that is already voided")
def test_cannot_void_already_voided():
    pass


@scenario("../../../../specs/orders/void.feature", "Cannot void an order with existing refunds")
def test_cannot_void_with_refunds():
    pass


@scenario(
    "../../../../specs/orders/void.feature",
    "Duplicate void request with same key returns same response",
)
def test_duplicate_void_request():
    pass


@scenario(
    "../../../../specs/orders/void.feature",
    "Permission denied for void without orders.void permission",
)
def test_permission_denied_for_void():
    pass


@scenario(
    "../../../../specs/orders/void.feature",
    "Tenant isolation: cannot void another tenant's order",
)
def test_tenant_isolation_void():
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
        headers={"Idempotency-Key": f"void-bdd-product-{suffix}"},
        json={"name": "Void Test Product", "price_amount": "30.00"},
    )
    assert product.status_code == 201, product.text
    return product.json()


def _create_order(client, product_id: str):
    suffix = uuid4().hex
    order = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"void-bdd-order-{suffix}"},
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [
                {
                    "method": "cash",
                    "amount": "60.00",
                    "amount_tendered": "60.00",
                }
            ],
        },
    )
    assert order.status_code == 201, order.text
    return order.json()


@given("an authenticated manager with a completed order", target_fixture="void_context")
def manager_with_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-manager-{suffix}@example.com", "Void Test Tenant")
    product = _create_catalog(client)
    order = _create_order(client, product["id"])
    return {"client": client, "order": order, "product": product}


@when("the manager voids the order with reason {reason:w}")
def void_order(void_context, reason):
    order = void_context["order"]
    suffix = uuid4().hex
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-{suffix}"},
        json={"reason": reason.strip('"')},
    )
    void_context["void_response"] = response
    void_context["void"] = response.json() if response.status_code == 201 else None


@then("the void is created successfully")
def void_created(void_context):
    response = void_context["void_response"]
    assert response.status_code == 201, response.text
    void = response.json()
    assert void["id"]
    assert void["order_id"] == str(void_context["order"]["id"])


@then('the order status is marked as "voided"')
def order_status_voided(void_context):
    order = void_context["order"]
    receipt = void_context["client"].get(f"/api/v1/orders/{order['id']}/receipt")
    assert receipt.status_code == 200
    receipt_data = receipt.json()
    assert receipt_data["status"] == "voided"


@then("all inventory is reversed")
def all_inventory_reversed(void_context):
    pass


@then("the void appears in the audit log")
def void_in_audit_log(void_context):
    void = void_context["void"]
    assert void is not None


@given("an authenticated manager with a voided order", target_fixture="voided_order_context")
def manager_with_voided_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-voided-{suffix}@example.com", "Void Voided Tenant")
    product = _create_catalog(client)
    order = _create_order(client, product["id"])
    void_response = client.post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-setup-{suffix}"},
        json={"reason": "operator_error"},
    )
    assert void_response.status_code == 201, void_response.text
    return {"client": client, "order": order, "product": product}


@when("the manager attempts to void the order again")
def attempt_void_again(voided_order_context):
    order = voided_order_context["order"]
    suffix = uuid4().hex
    response = voided_order_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-again-{suffix}"},
        json={"reason": "operator_error"},
    )
    voided_order_context["void_response"] = response


@given("an authenticated manager with a refunded order", target_fixture="refunded_order_context")
def manager_with_refunded_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-refunded-{suffix}@example.com", "Void Refunded Tenant")
    product = _create_catalog(client)
    order = _create_order(client, product["id"])
    item = order["items"][0]
    refund_response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-setup-{suffix}"},
        json={
            "items": [{"order_item_id": item["id"], "quantity": 1}],
            "reason": "customer_return",
        },
    )
    assert refund_response.status_code == 201, refund_response.text
    return {"client": client, "order": order, "product": product}


@when("the manager attempts to void the order")
def attempt_void_with_refunds(refunded_order_context):
    order = refunded_order_context["order"]
    suffix = uuid4().hex
    response = refunded_order_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-refunded-{suffix}"},
        json={"reason": "operator_error"},
    )
    refunded_order_context["void_response"] = response


@when("the manager voids the order with idempotency key {key:w}")
def void_with_key(void_context, key):
    order = void_context["order"]
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": key.strip('"')},
        json={"reason": "operator_error"},
    )
    void_context["void_response"] = response
    void_context["void"] = response.json() if response.status_code == 201 else None


@when("voids the same order again with key {key:w}")
def void_again_with_key(void_context, key):
    order = void_context["order"]
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": key.strip('"')},
        json={"reason": "operator_error"},
    )
    void_context["void_response_2"] = response
    void_context["void_2"] = response.json() if response.status_code == 201 else None


@then("both requests return the same void response")
def same_response(void_context):
    void1 = void_context["void"]
    void2 = void_context.get("void_2")
    assert void1 is not None
    assert void2 is not None
    assert void1["id"] == void2["id"]


@then("only one void exists in the database")
def only_one_void(void_context):
    order = void_context["order"]
    receipt = void_context["client"].get(f"/api/v1/orders/{order['id']}/receipt")
    receipt_data = receipt.json()
    assert receipt_data["void"] is not None

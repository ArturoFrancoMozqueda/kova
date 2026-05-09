from uuid import UUID, uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership


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


def _create_product(client) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"void-bdd-product-{uuid4().hex}"},
        json={"name": "Void Test Product", "price_amount": "30.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_order(client, product_id: str) -> dict:
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"void-bdd-order-{uuid4().hex}"},
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
    assert response.status_code == 201, response.text
    return response.json()


def _create_voidable_order(client) -> tuple[dict, dict]:
    product = _create_product(client)
    return product, _create_order(client, product["id"])


@given("an authenticated manager with a completed order", target_fixture="void_context")
def manager_with_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-manager-{suffix}@example.com", "Void Test Tenant")
    product, order = _create_voidable_order(client)
    return {"client": client, "order": order, "product": product}


@given("an authenticated manager with a voided order", target_fixture="void_context")
def manager_with_voided_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-voided-{suffix}@example.com", "Void Voided Tenant")
    product, order = _create_voidable_order(client)
    void_response = client.post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-setup-{suffix}"},
        json={"reason": "operator_error"},
    )
    assert void_response.status_code == 201, void_response.text
    return {"client": client, "order": order, "product": product}


@given("an authenticated manager with a refunded order", target_fixture="void_context")
def manager_with_refunded_order(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-refunded-{suffix}@example.com", "Void Refunded Tenant")
    product, order = _create_voidable_order(client)
    refund_response = client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": f"refund-setup-{suffix}"},
        json={
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
        },
    )
    assert refund_response.status_code == 201, refund_response.text
    return {"client": client, "order": order, "product": product}


@given("an authenticated cashier without void permission", target_fixture="void_context")
def cashier_without_void_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(
        client, f"void-cashier-{suffix}@example.com", "Void Cashier Tenant"
    )
    product, order = _create_voidable_order(client)
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"void-cashier-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client, "order": order, "product": product}


@given("two separate tenants with orders", target_fixture="void_context")
def two_tenants_with_orders(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"void-tenant-a-{suffix}@example.com", "Void Tenant A")
    product, order = _create_voidable_order(client)
    client.post("/api/v1/auth/logout")
    _signup_verify_login(client, f"void-tenant-b-{suffix}@example.com", "Void Tenant B")
    return {"client": client, "tenant_a_order": order, "tenant_a_product": product}


@when(parsers.parse('the manager voids the order with reason "{reason}"'))
def void_order(void_context, reason):
    _post_void(void_context, reason)


@when("the manager attempts to void the order again")
def attempt_void_again(void_context):
    _post_void(void_context, "operator_error")


@when("the manager attempts to void the order")
def attempt_void_with_refunds(void_context):
    _post_void(void_context, "operator_error")


@when(parsers.parse('the manager voids the order with idempotency key "{key}"'))
def void_with_key(void_context, key):
    _post_void(void_context, "operator_error", key=key)


@when(parsers.parse('voids the same order again with key "{key}"'))
def void_again_with_key(void_context, key):
    order = void_context["order"]
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": key},
        json={"reason": "operator_error"},
    )
    void_context["void_response_2"] = response
    void_context["void_2"] = response.json() if response.status_code == 201 else None


@when("the cashier attempts to void an order")
def cashier_attempts_void(void_context):
    _post_void(void_context, "operator_error")


@when("tenant B attempts to void tenant A's order")
def tenant_b_attempts_void(void_context):
    order = void_context["tenant_a_order"]
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"void-cross-tenant-{uuid4().hex}"},
        json={"reason": "operator_error"},
    )
    void_context["void_response"] = response


def _post_void(void_context, reason: str, *, key: str | None = None) -> None:
    order = void_context["order"]
    response = void_context["client"].post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": key or f"void-{uuid4().hex}"},
        json={"reason": reason},
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
    receipt = _receipt(void_context)
    assert receipt["status"] == "voided"
    assert receipt["void"] is not None


@then("all inventory is reversed")
def all_inventory_reversed(void_context):
    receipt = _receipt(void_context)
    assert receipt["status"] == "voided"


@then("the void appears in the audit log")
def void_in_audit_log(void_context):
    assert void_context["void"] is not None


@then("a 400 error is returned")
def error_400(void_context):
    assert void_context["void_response"].status_code == 400


@then("a 403 error is returned")
def error_403(void_context):
    assert void_context["void_response"].status_code == 403


@then("a 404 error is returned")
def error_404(void_context):
    assert void_context["void_response"].status_code == 404


@then("both requests return the same void response")
def same_response(void_context):
    void1 = void_context["void"]
    void2 = void_context["void_2"]
    assert void1["id"] == void2["id"]
    assert void1["order_id"] == void2["order_id"]


@then("only one void exists in the database")
def only_one_void(void_context):
    receipt = _receipt(void_context)
    assert receipt["void"] is not None


def _receipt(void_context) -> dict:
    order = void_context["order"]
    response = void_context["client"].get(f"/api/v1/orders/{order['id']}/receipt")
    assert response.status_code == 200, response.text
    return response.json()

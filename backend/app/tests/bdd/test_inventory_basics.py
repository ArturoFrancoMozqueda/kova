from uuid import UUID, uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.audit.models import AuditLog
from app.auth.models import Membership


@scenario("../../../../specs/inventory/inventory_basics.feature", "Manager manually adjusts stock")
def test_manager_adjusts_stock():
    pass


@scenario("../../../../specs/inventory/inventory_basics.feature", "Manager performs a stock take")
def test_manager_performs_stock_take():
    pass


@scenario(
    "../../../../specs/inventory/inventory_basics.feature", "Low stock threshold flags product"
)
def test_low_stock_threshold_flags_product():
    pass


@scenario(
    "../../../../specs/inventory/inventory_basics.feature",
    "Permission denied without inventory adjust permission",
)
def test_permission_denied_without_inventory_adjust():
    pass


@scenario(
    "../../../../specs/inventory/inventory_basics.feature",
    "Tenant isolation: cannot see another tenant's stock",
)
def test_tenant_isolation_inventory_stock():
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


def _create_tracked_product(client, *, name: str = "Inventory Test Product") -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"inventory-product-{uuid4().hex}"},
        json={
            "name": name,
            "sku": f"INV-{uuid4().hex[:8]}",
            "price_amount": "10.00",
            "track_inventory": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _adjust(client, product_id: str, quantity_delta: int, reason: str):
    return client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": f"inventory-adjust-{uuid4().hex}"},
        json={"quantity_delta": quantity_delta, "reason": reason},
    )


@given("an authenticated manager with a tracked product", target_fixture="inventory_context")
def manager_with_tracked_product(client):
    suffix = uuid4().hex
    _signup_verify_login(
        client, f"inventory-manager-{suffix}@example.com", "Inventory Manager Tenant"
    )
    product = _create_tracked_product(client)
    return {"client": client, "product": product}


@given(
    parsers.parse("an authenticated manager with stock on hand of {stock:d}"),
    target_fixture="inventory_context",
)
def manager_with_stock(client, stock):
    suffix = uuid4().hex
    _signup_verify_login(client, f"inventory-stock-{suffix}@example.com", "Inventory Stock Tenant")
    product = _create_tracked_product(client)
    response = _adjust(client, product["id"], stock, "setup_count")
    assert response.status_code == 201, response.text
    return {"client": client, "product": product, "setup_response": response.json()}


@given(
    "an authenticated cashier without inventory adjust permission",
    target_fixture="inventory_context",
)
def cashier_without_inventory_adjust(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(
        client, f"inventory-cashier-{suffix}@example.com", "Inventory Cashier Tenant"
    )
    product = _create_tracked_product(client)
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"inventory-cashier-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client, "product": product}


@given("tenant A has a tracked product with stock", target_fixture="inventory_context")
def tenant_a_has_stock(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"inventory-tenant-a-{suffix}@example.com", "Inventory Tenant A")
    product = _create_tracked_product(client, name="Tenant A Private Product")
    response = _adjust(client, product["id"], 7, "opening_count")
    assert response.status_code == 201, response.text
    client.post("/api/v1/auth/logout")
    _signup_verify_login(client, f"inventory-tenant-b-{suffix}@example.com", "Inventory Tenant B")
    return {"client": client, "tenant_a_product": product}


@when(parsers.parse('the manager adjusts stock by {quantity_delta:d} with reason "{reason}"'))
def manager_adjusts_stock(inventory_context, quantity_delta, reason):
    response = _adjust(
        inventory_context["client"], inventory_context["product"]["id"], quantity_delta, reason
    )
    inventory_context["response"] = response
    inventory_context["movement"] = response.json() if response.status_code == 201 else None


@when(parsers.parse('the manager records a stock take count of {count:d} with reason "{reason}"'))
def manager_records_stock_take(inventory_context, count, reason):
    response = inventory_context["client"].post(
        f"/api/v1/inventory/products/{inventory_context['product']['id']}/stock-take",
        headers={"Idempotency-Key": f"inventory-stock-take-{uuid4().hex}"},
        json={"counted_quantity": count, "reason": reason},
    )
    inventory_context["response"] = response
    inventory_context["movement"] = response.json() if response.status_code == 201 else None


@when(parsers.parse("the manager sets the low stock threshold to {threshold:d}"))
def manager_sets_low_stock_threshold(inventory_context, threshold):
    response = inventory_context["client"].patch(
        f"/api/v1/inventory/products/{inventory_context['product']['id']}/low-stock-threshold",
        headers={"Idempotency-Key": f"inventory-threshold-{uuid4().hex}"},
        json={"low_stock_threshold": threshold},
    )
    inventory_context["response"] = response
    assert response.status_code == 200, response.text


@when("the cashier attempts to adjust stock")
def cashier_attempts_adjust_stock(inventory_context):
    inventory_context["response"] = _adjust(
        inventory_context["client"],
        inventory_context["product"]["id"],
        3,
        "unauthorized_count",
    )


@when("tenant B views the inventory stock list")
def tenant_b_views_inventory_stock_list(inventory_context):
    response = inventory_context["client"].get("/api/v1/inventory/stock")
    assert response.status_code == 200, response.text
    inventory_context["stock_list"] = response.json()


@then(parsers.parse("the product stock on hand is {expected_stock:d}"))
def product_stock_on_hand_is(inventory_context, expected_stock):
    response = inventory_context["client"].get("/api/v1/inventory/stock")
    assert response.status_code == 200, response.text
    product_id = inventory_context["product"]["id"]
    stock_item = next(item for item in response.json() if item["product_id"] == product_id)
    assert stock_item["stock_on_hand"] == expected_stock


@then("the adjustment appears in the audit log")
def adjustment_appears_in_audit_log(inventory_context, db):
    audit = (
        db.query(AuditLog)
        .filter(
            AuditLog.resource_id == UUID(inventory_context["product"]["id"]),
            AuditLog.action == "inventory.adjust",
        )
        .one()
    )
    assert audit.changes["quantity_delta"] == 12


@then(parsers.parse("the stock take delta is {expected_delta:d}"))
def stock_take_delta_is(inventory_context, expected_delta):
    assert inventory_context["movement"]["quantity_delta"] == expected_delta


@then("the product appears in the low stock list")
def product_appears_in_low_stock_list(inventory_context):
    response = inventory_context["client"].get("/api/v1/inventory/low-stock")
    assert response.status_code == 200, response.text
    product_ids = {item["product_id"] for item in response.json()}
    assert inventory_context["product"]["id"] in product_ids


@then("a 403 error is returned")
def error_403_returned(inventory_context):
    assert inventory_context["response"].status_code == 403


@then("tenant A's product is not returned")
def tenant_a_product_is_not_returned(inventory_context):
    product_ids = {item["product_id"] for item in inventory_context["stock_list"]}
    assert inventory_context["tenant_a_product"]["id"] not in product_ids

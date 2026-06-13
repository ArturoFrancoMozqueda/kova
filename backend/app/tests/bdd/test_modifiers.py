from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenario, then, when

from app.main import app


@scenario(
    "../../../../specs/catalog/modifiers.feature",
    "Owner creates modifier group, assigns to product, cashier orders with modifier",
)
def test_modifier_pricing():
    pass


@scenario(
    "../../../../specs/catalog/modifiers.feature",
    "Multiple modifier groups sum correctly",
)
def test_multiple_modifier_groups_sum():
    pass


@scenario(
    "../../../../specs/catalog/modifiers.feature",
    "Required modifier not selected is rejected",
)
def test_required_modifier_rejected():
    pass


@scenario(
    "../../../../specs/catalog/modifiers.feature",
    "Cashier cannot create modifier groups",
)
def test_cashier_cannot_create_modifier_group():
    pass


@scenario(
    "../../../../specs/catalog/modifiers.feature",
    "Modifier groups are tenant-scoped",
)
def test_modifier_groups_tenant_scoped():
    pass


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    signup = r.json()
    client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    return signup


def _open_shift(client: TestClient) -> dict:
    r = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"mod-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_product(client: TestClient, name: str, price: str) -> dict:
    r = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": str(uuid4())},  # uuid4 is always ASCII-safe
        json={"name": name, "price_amount": price},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _create_group(client: TestClient, name: str, *, required: bool = False) -> dict:
    r = client.post(
        "/api/v1/catalog/modifier-groups",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": name, "is_required": required, "min_selections": 1 if required else 0},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _add_option(client: TestClient, group_id: str, name: str, delta: str) -> dict:
    r = client.post(
        f"/api/v1/catalog/modifier-groups/{group_id}/options",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": name, "price_delta": delta},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _assign_groups(client: TestClient, product_id: str, *group_ids: str) -> None:
    r = client.put(
        f"/api/v1/catalog/products/{product_id}/modifier-groups",
        json={"assignments": [{"modifier_group_id": gid} for gid in group_ids]},
    )
    assert r.status_code == 200, r.text


def _create_order(client: TestClient, product_id: str, option_ids: list[str], total: str) -> dict:
    r = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "items": [{"product_id": product_id, "quantity": 1, "modifier_option_ids": option_ids}],
            "payments": [{"method": "cash", "amount": total, "amount_tendered": total}],
        },
    )
    return r


# ─── Scenario 1: modifier pricing ────────────────────────────────────────────

@given(
    parsers.parse('a verified tenant owner with a product "{name}" priced at "{price}"'),
    target_fixture="mod_context",
)
def owner_with_product(client, name, price):
    suffix = uuid4().hex[:8]
    _signup_verify_login(client, f"mod-owner-{suffix}@example.com", f"Mod Bakery {suffix}")
    _open_shift(client)
    product = _create_product(client, name, price)
    return {"client": client, "product": product}


@given(parsers.parse('the owner creates modifier group "{group_name}" with options "{opt1}" and "{opt2}"'))
def owner_creates_group_with_options(mod_context, group_name, opt1, opt2):
    client = mod_context["client"]
    group = _create_group(client, group_name)
    # Parse "Name +price" format
    n1, d1 = opt1.rsplit("+", 1)
    n2, d2 = opt2.rsplit("+", 1)
    option1 = _add_option(client, group["id"], n1.strip(), d1.strip())
    option2 = _add_option(client, group["id"], n2.strip(), d2.strip())
    mod_context.setdefault("groups", {})[group_name] = group
    mod_context.setdefault("options", {})[n1.strip()] = option1
    mod_context.setdefault("options", {})[n2.strip()] = option2


@given(parsers.parse('the owner assigns "{group_name}" to "{product_name}"'))
def owner_assigns_group_to_product(mod_context, group_name, product_name):
    # Accumulate so that multiple sequential calls build up the full assignment list
    group = mod_context["groups"][group_name]
    assigned = mod_context.setdefault("assigned_group_ids", [])
    if group["id"] not in assigned:
        assigned.append(group["id"])
    _assign_groups(mod_context["client"], mod_context["product"]["id"], *assigned)


@when(parsers.parse('the cashier creates an order with "{product_name}" selecting modifier "{option_name}"'))
def cashier_orders_with_modifier(mod_context, product_name, option_name):
    option = mod_context["options"][option_name]
    total = str(Decimal(mod_context["product"]["price_amount"]) + Decimal(option["price_delta"]))
    r = _create_order(mod_context["client"], mod_context["product"]["id"], [option["id"]], total)
    assert r.status_code == 201, r.text
    mod_context["order"] = r.json()


@then(parsers.parse('the order item unit price is "{expected_price}"'))
def order_item_unit_price(mod_context, expected_price):
    item = mod_context["order"]["items"][0]
    assert item["unit_price_amount"] == expected_price


@then(parsers.parse('the order item modifier snapshot records "{option_name}" with price delta "{delta}"'))
def modifier_snapshot_recorded(mod_context, option_name, delta):
    item = mod_context["order"]["items"][0]
    assert any(
        m["modifier_option_name"] == option_name and m["price_delta_amount"] == delta
        for m in item["modifiers"]
    )


# ─── Scenario 2: multiple modifier groups ────────────────────────────────────

@given(parsers.parse('the owner creates modifier group "{g1}" with options "{g1_opt1}" and "{g1_opt2}"'))
def owner_creates_first_group(mod_context, g1, g1_opt1, g1_opt2):
    owner_creates_group_with_options(mod_context, g1, g1_opt1, g1_opt2)


@given(parsers.parse('the owner creates modifier group "{g2}" with options "{g2_opt1}" and "{g2_opt2}"'))
def owner_creates_second_group(mod_context, g2, g2_opt1, g2_opt2):
    owner_creates_group_with_options(mod_context, g2, g2_opt1, g2_opt2)


@when(parsers.parse('the cashier creates an order with "{product_name}" selecting "{opt1}" and "{opt2}"'))
def cashier_orders_with_two_modifiers(mod_context, product_name, opt1, opt2):
    option1 = mod_context["options"][opt1]
    option2 = mod_context["options"][opt2]
    total = str(
        Decimal(mod_context["product"]["price_amount"])
        + Decimal(option1["price_delta"])
        + Decimal(option2["price_delta"])
    )
    r = _create_order(
        mod_context["client"], mod_context["product"]["id"],
        [option1["id"], option2["id"]],
        total,
    )
    assert r.status_code == 201, r.text
    mod_context["order"] = r.json()


# ─── Scenario 3: required modifier validation ────────────────────────────────

@given(parsers.parse('the owner creates required modifier group "{group_name}" with options "{opt1}" and "{opt2}"'))
def owner_creates_required_group(mod_context, group_name, opt1, opt2):
    client = mod_context["client"]
    group = _create_group(client, group_name, required=True)
    n1, d1 = opt1.rsplit("+", 1)
    n2, d2 = opt2.rsplit("+", 1)
    option1 = _add_option(client, group["id"], n1.strip(), d1.strip())
    option2 = _add_option(client, group["id"], n2.strip(), d2.strip())
    mod_context.setdefault("groups", {})[group_name] = group
    mod_context.setdefault("options", {})[n1.strip()] = option1
    mod_context.setdefault("options", {})[n2.strip()] = option2


@when(parsers.parse('the cashier creates an order with "{product_name}" without selecting any modifiers'))
def cashier_orders_without_modifiers(mod_context, product_name):
    # Total doesn't matter — validation fails before payment check
    total = mod_context["product"]["price_amount"]
    r = _create_order(mod_context["client"], mod_context["product"]["id"], [], total)
    mod_context["error_response"] = r


@then("the order is rejected with modifier validation error")
def order_rejected_modifier_validation(mod_context):
    assert mod_context["error_response"].status_code == 400
    assert "requires" in mod_context["error_response"].json()["detail"].lower()


# ─── Scenario 4: cashier cannot create modifier groups ───────────────────────

@given("a verified tenant cashier", target_fixture="cashier_context")
def verified_tenant_cashier(client, db):
    from uuid import UUID

    from app.auth.models import Membership
    suffix = uuid4().hex[:8]
    signup = _signup_verify_login(client, f"mod-cashier-{suffix}@example.com", f"Cashier Bakery {suffix}")
    membership = db.query(Membership).filter(
        Membership.user_id == UUID(signup["user_id"])
    ).first()
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={
        "email": f"mod-cashier-{suffix}@example.com", "password": "S3cur3pass!"
    })
    return {"client": client}


@when("the cashier attempts to create a modifier group")
def cashier_attempts_create_group(cashier_context):
    r = cashier_context["client"].post(
        "/api/v1/catalog/modifier-groups",
        headers={"Idempotency-Key": "cashier-group-attempt"},
        json={"name": "Forbidden Size"},
    )
    cashier_context["response"] = r


@then("the catalog request is rejected with permission denied")
def catalog_request_permission_denied(cashier_context):
    assert cashier_context["response"].status_code == 403


# ─── Scenario 5: tenant isolation ────────────────────────────────────────────

@given("two verified tenant owners", target_fixture="isolation_context")
def two_tenant_owners():
    client_a = TestClient(app)
    client_b = TestClient(app)
    suffix = uuid4().hex[:8]
    _signup_verify_login(client_a, f"mod-iso-a-{suffix}@example.com", f"Iso Tenant A {suffix}")
    _signup_verify_login(client_b, f"mod-iso-b-{suffix}@example.com", f"Iso Tenant B {suffix}")
    return {"client_a": client_a, "client_b": client_b}


@when(parsers.parse('the first tenant creates a modifier group "{group_name}"'))
def first_tenant_creates_group(isolation_context, group_name):
    _create_group(isolation_context["client_a"], group_name)


@then(parsers.parse('the second tenant cannot see "{group_name}" in their modifier groups'))
def second_tenant_cannot_see_group(isolation_context, group_name):
    r = isolation_context["client_b"].get("/api/v1/catalog/modifier-groups")
    assert r.status_code == 200, r.text
    names = [g["name"] for g in r.json()]
    assert group_name not in names

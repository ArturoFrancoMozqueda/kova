"""Selling a prepared drink moves its ingredients and freezes the real cost."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.orders.models import OrderItem
from app.tests.test_orders import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _post(client, path: str, body: dict):
    return client.post(f"/api/v1/{path}", json=body, headers={"Idempotency-Key": str(uuid4())})


def _put(client, path: str, body: dict, key: str | None = None):
    return client.put(
        f"/api/v1/{path}", json=body, headers={"Idempotency-Key": key or str(uuid4())}
    )


def _login(client, label: str) -> dict:
    account = _signup_verify_login(client, f"{label}-{uuid4().hex}@example.com", label)
    assert _post(client, "shifts", {"opening_cash_amount": "0.00"}).status_code == 201
    return account


def _ingredient(client, name: str, *, cost: str | None, unit: str = "ml", stock: int = 0,
                purchase=("Litro", 1000)) -> dict:
    body = {
        "name": name, "price_amount": "0.00", "cost_price": cost, "track_inventory": True,
        "is_sellable": False, "stock_unit": unit,
    }
    if purchase:
        body |= {"purchase_unit_label": purchase[0], "purchase_unit_quantity": purchase[1]}
    response = _post(client, "catalog/products", body)
    assert response.status_code == 201, response.text
    product = response.json()
    if stock:
        assert _post(
            client, f"inventory/products/{product['id']}/adjustments",
            {"quantity_delta": stock, "reason": "Compra inicial"},
        ).status_code == 201
    return product


def _latte(client) -> dict:
    response = _post(client, "catalog/products", {"name": "Latte", "price_amount": "55.00"})
    assert response.status_code == 201, response.text
    return response.json()


def _stock(client, product_id: str) -> int:
    rows = client.get("/api/v1/inventory/stock").json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    return next(row["stock_on_hand"] for row in rows if row["product_id"] == product_id)


def _sell(client, product: dict, *, quantity: int = 1, options: list[str] | None = None,
          client_uuid: str | None = None, occurred_at: str | None = None):
    total = str(Decimal("55.00") * quantity)
    item = {"product_id": product["id"], "quantity": quantity,
            "modifier_option_ids": options or []}
    order = {"items": [item],
             "payments": [{"method": "cash", "amount": total, "amount_tendered": total}]}
    if client_uuid is None:
        response = _post(client, "orders", order)
        assert response.status_code == 201, response.text
        return response.json()
    sale = {"client_uuid": client_uuid, "order": order}
    if occurred_at:
        sale["occurred_at"] = occurred_at
    response = client.post("/api/v1/sync/offline-sales", json={"sales": [sale]})
    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["status"] == "synced", result
    return result["order"]


def _almond_option(client, latte: dict, milk: dict, almond: dict) -> str:
    group = _post(client, "catalog/modifier-groups", {"name": "Leche"}).json()
    option = _post(
        client, f"catalog/modifier-groups/{group['id']}/options",
        {"name": "Almendra", "price_delta": "0.00"},
    ).json()
    assigned = client.put(
        f"/api/v1/catalog/products/{latte['id']}/modifier-groups",
        json={"assignments": [{"modifier_group_id": group["id"], "sort_order": 0}]},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert assigned.status_code == 200, assigned.text
    saved = _put(client, f"catalog/modifier-options/{option['id']}/consumption", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": -240},
        {"ingredient_product_id": almond["id"], "quantity": 240},
    ]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["cost_delta"] == "4.80"
    return option["id"]


def test_latte_with_almond_milk_moves_ingredients_and_freezes_recipe_cost(client, db):
    _login(client, "receta-latte")
    milk = _ingredient(client, "Leche entera", cost="25.00", stock=2000)
    almond = _ingredient(client, "Leche de almendra", cost="45.00", stock=1000)
    coffee = _ingredient(client, "Café en grano", cost="400.00", unit="g", stock=1000,
                         purchase=("Kilo", 1000))
    latte = _latte(client)

    recipe = _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 240},
        {"ingredient_product_id": coffee["id"], "quantity": 18},
    ]})
    assert recipe.status_code == 200, recipe.text
    # 240 ml × $0.025 + 18 g × $0.40 = $6.00 + $7.20
    assert (recipe.json()["version"], recipe.json()["cost"]) == (1, "13.20")
    almond_option = _almond_option(client, latte, milk, almond)

    plain = _sell(client, latte, quantity=2)
    substituted = _sell(client, latte, options=[almond_option])

    assert _stock(client, milk["id"]) == 2000 - 480
    assert _stock(client, almond["id"]) == 1000 - 240
    assert _stock(client, coffee["id"]) == 1000 - 54
    plain_line = db.get(OrderItem, UUID(plain["items"][0]["id"]))
    almond_line = db.get(OrderItem, UUID(substituted["items"][0]["id"]))
    assert plain_line.unit_cost == Decimal("13.20")
    # Almond milk replaces whole milk: 240 ml × $0.045 + $7.20.
    assert almond_line.unit_cost == Decimal("18.00")


def test_ingredient_stock_never_blocks_a_sale_and_refunds_never_restore_it(client):
    _login(client, "receta-sin-bloqueo")
    milk = _ingredient(client, "Leche entera", cost="25.00", stock=100)
    latte = _latte(client)
    _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 240},
    ]})

    sale = _sell(client, latte)
    assert _stock(client, milk["id"]) == -140

    refund = _post(client, f"orders/{sale['id']}/refunds", {
        "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return", "refund_payment_method": "cash",
    })
    assert refund.status_code == 201, refund.text
    assert refund.json()["items"][0]["restocked_quantity"] == 0
    assert _stock(client, milk["id"]) == -140


def test_void_puts_consumed_ingredients_back_once(client):
    _login(client, "receta-anulacion")
    milk = _ingredient(client, "Leche entera", cost="25.00", stock=1000)
    latte = _latte(client)
    _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 240},
    ]})
    sale = _sell(client, latte)
    key = str(uuid4())

    first = client.post(f"/api/v1/orders/{sale['id']}/void", json={"reason": "operator_error"},
                        headers={"Idempotency-Key": key})
    replay = client.post(f"/api/v1/orders/{sale['id']}/void", json={"reason": "operator_error"},
                         headers={"Idempotency-Key": key})

    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert _stock(client, milk["id"]) == 1000


def test_offline_sale_uses_the_recipe_in_force_when_it_was_rung(client, db):
    _login(client, "receta-offline")
    milk = _ingredient(client, "Leche entera", cost="25.00", stock=1000)
    latte = _latte(client)
    _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 200},
    ]})
    # Version 1 was already in force an hour ago; the sale was rung 10 minutes
    # ago, offline, and version 2 is saved only now.
    db.execute(
        text("UPDATE recipes SET effective_from = now() - interval '1 hour' "
             "WHERE product_id = :p AND version = 1"),
        {"p": latte["id"]},
    )
    db.commit()
    second = _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 300},
    ]})
    assert second.json()["version"] == 2
    rung_at = datetime.now(UTC) - timedelta(minutes=10)

    order = _sell(client, latte, client_uuid=str(uuid4()), occurred_at=rung_at.isoformat())

    assert _stock(client, milk["id"]) == 800
    assert db.get(OrderItem, UUID(order["items"][0]["id"])).unit_cost == Decimal("5.00")


def test_unknown_ingredient_cost_leaves_the_line_cost_unknown_not_zero(client, db):
    _login(client, "receta-sin-costo")
    milk = _ingredient(client, "Leche entera", cost=None, stock=1000)
    latte = _latte(client)
    saved = _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 240},
    ]})
    assert saved.json()["cost"] is None
    assert saved.json()["ingredients_without_cost"] == 1

    sale = _sell(client, latte)
    assert db.get(OrderItem, UUID(sale["items"][0]["id"])).unit_cost is None


def test_recipe_rules_protect_against_double_counting(client):
    _login(client, "receta-reglas")
    milk = _ingredient(client, "Leche entera", cost="25.00")
    stocked = _post(client, "catalog/products", {
        "name": "Concha", "price_amount": "18.00", "track_inventory": True,
    }).json()
    latte = _latte(client)
    line = {"lines": [{"ingredient_product_id": milk["id"], "quantity": 240}]}

    assert _put(client, f"catalog/products/{stocked['id']}/recipe", line).status_code == 400
    assert _put(client, f"catalog/products/{milk['id']}/recipe", line).status_code == 400
    assert _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": latte["id"], "quantity": 1},
    ]}).status_code == 400
    assert _put(client, f"catalog/products/{latte['id']}/recipe", line).status_code == 200
    track = client.patch(
        f"/api/v1/catalog/products/{latte['id']}", json={"track_inventory": True},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert track.status_code == 400, track.text


def test_cashier_cannot_read_recipe_costs_and_other_tenants_cannot_use_ingredients(client):
    _login(client, "receta-tenant-a")
    milk = _ingredient(client, "Leche entera", cost="25.00")
    client.post("/api/v1/auth/logout")
    client.cookies.clear()

    _login(client, "receta-tenant-b")
    latte = _latte(client)
    foreign = _put(client, f"catalog/products/{latte['id']}/recipe", {"lines": [
        {"ingredient_product_id": milk["id"], "quantity": 240},
    ]})
    assert foreign.status_code == 400, foreign.text
    assert client.get(f"/api/v1/catalog/products/{milk['id']}/recipe").status_code == 404

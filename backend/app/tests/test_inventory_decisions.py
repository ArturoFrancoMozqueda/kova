"""Panel decisions created by recipes: negative counts to verify and costs to complete."""

from uuid import uuid4

import pytest

from app.tests.test_recipes_on_sale import _ingredient, _latte, _login, _post, _put

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _control(client) -> dict:
    response = client.get("/api/v1/reports/dashboard", params={"period": "day", "branch_id": "all"})
    assert response.status_code == 200, response.text
    return response.json()["control_center"]


def _metric(control: dict, key: str) -> dict | None:
    for area in control["areas"]:
        for metric in area.get("metrics", []):
            if metric["key"] == key:
                return metric
    return None


def test_consumption_below_zero_becomes_a_count_to_verify(client):
    _login(client, "panel-negativo")
    milk = _ingredient(client, "Leche entera", cost="25.00", stock=100)
    latte = _latte(client)
    _put(client, f"catalog/products/{latte['id']}/recipe",
         {"lines": [{"ingredient_product_id": milk["id"], "quantity": 240}]})
    assert _post(client, "orders", {
        "items": [{"product_id": latte["id"], "quantity": 1}],
        "payments": [{"method": "cash", "amount": "55.00", "amount_tendered": "55.00"}],
    }).status_code == 201

    control = _control(client)
    alert = next(a for a in control["alerts"] if a["key"] == "negative_stock")
    assert (alert["count"], alert["route_key"], alert["title"]) == (
        1, "inventory", "Existencias negativas por contar")
    assert _metric(control, "negative_stock")["value"] == "1"

    # A physical count settles the difference and the alert disappears.
    counted = client.post(
        f"/api/v1/inventory/products/{milk['id']}/stock-take",
        json={"counted_quantity": 0, "reason": "Conteo de leche"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert counted.status_code in (200, 201), counted.text
    assert not [a for a in _control(client)["alerts"] if a["key"] == "negative_stock"]


def test_ingredients_without_cost_in_active_recipes_are_listed_once(client):
    _login(client, "panel-costos")
    milk = _ingredient(client, "Leche entera", cost=None)
    coffee = _ingredient(client, "Café en grano", cost="400.00", unit="g", purchase=("Kilo", 1000))
    latte = _latte(client)
    capuchino = _post(client, "catalog/products",
                      {"name": "Capuchino", "price_amount": "50.00"}).json()
    for product in (latte, capuchino):
        _put(client, f"catalog/products/{product['id']}/recipe", {"lines": [
            {"ingredient_product_id": milk["id"], "quantity": 200},
            {"ingredient_product_id": coffee["id"], "quantity": 18},
        ]})

    rows = client.get("/api/v1/catalog/recipes/missing-costs").json()
    assert rows == [{"ingredient_product_id": milk["id"], "ingredient_name": "Leche entera",
                     "used_in": ["Capuchino", "Latte"]}]
    assert _metric(_control(client), "recipe_costs_missing")["value"] == "1"

    # A recipe that stops using the ingredient no longer counts it.
    _put(client, f"catalog/products/{capuchino['id']}/recipe", {"lines": [
        {"ingredient_product_id": coffee["id"], "quantity": 18},
    ]})
    assert client.get("/api/v1/catalog/recipes/missing-costs").json()[0]["used_in"] == ["Latte"]

    priced = client.patch(f"/api/v1/catalog/products/{milk['id']}", json={"cost_price": "25.00"},
                          headers={"Idempotency-Key": str(uuid4())})
    assert priced.status_code == 200, priced.text
    assert client.get("/api/v1/catalog/recipes/missing-costs").json() == []
    assert _metric(_control(client), "recipe_costs_missing")["value"] == "0"


def test_other_business_does_not_see_missing_costs(client):
    _login(client, "panel-costos-a")
    milk = _ingredient(client, "Leche entera", cost=None)
    latte = _latte(client)
    _put(client, f"catalog/products/{latte['id']}/recipe",
         {"lines": [{"ingredient_product_id": milk["id"], "quantity": 200}]})
    client.post("/api/v1/auth/logout")
    client.cookies.clear()

    _login(client, "panel-costos-b")
    assert client.get("/api/v1/catalog/recipes/missing-costs").json() == []

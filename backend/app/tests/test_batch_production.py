"""A tray of conchas consumes ingredients once; selling pieces moves only the pieces."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.orders.models import OrderItem
from app.tests.test_recipes_on_sale import _ingredient, _login, _post, _put, _stock

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _concha(client, **extra) -> dict:
    response = _post(client, "catalog/products", {
        "name": "Concha", "price_amount": "18.00", "track_inventory": True, **extra,
    })
    assert response.status_code == 201, response.text
    return response.json()


def _setup(client, label: str, *, flour_cost: str | None = "30.00"):
    _login(client, label)
    flour = _ingredient(client, "Harina", cost=flour_cost, unit="g", stock=5000,
                        purchase=("Kilo", 1000))
    sugar = _ingredient(client, "Azúcar", cost="24.00", unit="g", stock=2000,
                        purchase=("Kilo", 1000))
    concha = _concha(client)
    saved = _put(client, f"catalog/products/{concha['id']}/batch-recipe", {
        "batch_yield": 24,
        "lines": [
            {"ingredient_product_id": flour["id"], "quantity": 1000},
            {"ingredient_product_id": sugar["id"], "quantity": 250},
        ],
    })
    assert saved.status_code == 200, saved.text
    return flour, sugar, concha, saved.json()


def _produce(client, concha: dict, *, batches: int = 1, actual: int, reason: str | None = None,
             key: str | None = None, update_cost: bool = True):
    body = {"product_id": concha["id"], "batches": batches, "actual_quantity": actual,
            "update_catalog_cost": update_cost}
    if reason:
        body["waste_reason_code"] = reason
    return client.post("/api/v1/inventory/production", json=body,
                       headers={"Idempotency-Key": key or str(uuid4())})


def test_tray_consumes_once_records_loss_and_pieces_sell_without_double_discount(client, db):
    flour, sugar, concha, recipe = _setup(client, "lote-conchas")
    # 1000 g × $0.03 + 250 g × $0.024 = $36.00 per tray of 24 → $1.50 per expected piece.
    assert (recipe["batch_yield"], recipe["cost"], recipe["cost_per_piece"]) == (24, "36.00", "1.50")

    batch = _produce(client, concha, batches=2, actual=45, reason="daño")
    assert batch.status_code == 201, batch.text
    body = batch.json()
    assert (body["expected_quantity"], body["actual_quantity"], body["shortfall"]) == (48, 45, 3)
    assert body["ingredient_cost"] == "72.00"
    assert body["unit_cost"] == "1.60"
    assert body["catalog_cost_updated"] is True
    assert _stock(client, flour["id"]) == 3000
    assert _stock(client, sugar["id"]) == 1500
    assert _stock(client, concha["id"]) == 45

    sale = _post(client, "orders", {
        "items": [{"product_id": concha["id"], "quantity": 2}],
        "payments": [{"method": "cash", "amount": "36.00", "amount_tendered": "36.00"}],
    })
    assert sale.status_code == 201, sale.text
    assert _stock(client, concha["id"]) == 43
    assert _stock(client, flour["id"]) == 3000
    line = db.get(OrderItem, UUID(sale.json()["items"][0]["id"]))
    assert line.unit_cost == Decimal("1.60")

    waste = client.get("/api/v1/reports/business-story").json()["waste"]["production_shortfall"]
    # 3 lost pieces × ($72 / 48 expected) = $4.50
    assert (waste["units"], waste["value"]) == (3, "4.50")


def test_retry_with_the_same_key_records_one_batch(client):
    flour, _, concha, _ = _setup(client, "lote-reintento")
    key = str(uuid4())

    first = _produce(client, concha, actual=24, key=key)
    replay = _produce(client, concha, actual=24, key=key)

    assert first.status_code == replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert _stock(client, concha["id"]) == 24
    assert _stock(client, flour["id"]) == 4000
    assert len(client.get("/api/v1/inventory/production").json()) == 1


def test_shortfall_needs_a_reason_and_a_full_batch_needs_none(client):
    _, _, concha, _ = _setup(client, "lote-motivo")

    assert _produce(client, concha, actual=20).status_code == 400
    assert _produce(client, concha, actual=24, reason="merma").status_code == 400
    assert _produce(client, concha, actual=26).status_code == 201


def test_unknown_ingredient_cost_keeps_piece_cost_unknown_and_catalog_untouched(client):
    _, _, concha, recipe = _setup(client, "lote-sin-costo", flour_cost=None)
    assert recipe["cost"] is None and recipe["cost_per_piece"] is None

    body = _produce(client, concha, actual=24).json()

    assert body["unit_cost"] is None and body["ingredient_cost"] is None
    assert body["catalog_cost_updated"] is False
    product = next(p for p in client.get("/api/v1/catalog/products").json()
                   if p["id"] == concha["id"])
    assert product["cost_price"] is None


def test_batch_and_sale_recipes_cannot_overlap(client):
    _login(client, "lote-reglas")
    flour = _ingredient(client, "Harina", cost="30.00", unit="g", purchase=("Kilo", 1000))
    latte = _post(client, "catalog/products", {"name": "Latte", "price_amount": "55.00"}).json()
    concha = _concha(client)
    line = {"lines": [{"ingredient_product_id": flour["id"], "quantity": 100}]}

    # No own stock: cannot produce in batches. Own stock: cannot be prepared at sale.
    assert _put(client, f"catalog/products/{latte['id']}/batch-recipe",
                {"batch_yield": 1, **line}).status_code == 400
    assert _put(client, f"catalog/products/{concha['id']}/recipe", line).status_code == 400
    assert _produce(client, concha, actual=1).status_code == 400  # no batch recipe yet


def test_other_business_cannot_produce_or_list_batches(client):
    _, _, concha, _ = _setup(client, "lote-tenant-a")
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _login(client, "lote-tenant-b")

    foreign = _produce(client, concha, actual=24)
    assert foreign.status_code == 404, foreign.text
    assert client.get("/api/v1/inventory/production").json() == []

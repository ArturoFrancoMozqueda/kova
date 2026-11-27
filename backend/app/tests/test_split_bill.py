"""Split the bill: each friend pays what they had, in one sale with one receipt."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.orders.models import OrderItem, Payment
from app.tests.test_customer_order_deposits import _cake_order, _deposit, _owner, _post
from app.tests.test_customer_orders import _confirm

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _product(client, name: str, price: str) -> dict:
    response = client.post("/api/v1/catalog/products", headers={"Idempotency-Key": str(uuid4())},
                           json={"name": name, "price_amount": price})
    assert response.status_code == 201, response.text
    return response.json()


def _sell(client, body: dict, key: str | None = None):
    return client.post("/api/v1/orders", json=body, headers={"Idempotency-Key": key or str(uuid4())})


def _three_friends(latte: dict, sandwich: dict, payments: list[dict]) -> dict:
    # Ana and Beto had a latte each, Carla a sandwich; an $18 discount is shared by line.
    return {
        "discount_amount": "18.00",
        "items": [
            {"product_id": latte["id"], "quantity": 1, "split_group": 1},
            {"product_id": latte["id"], "quantity": 1, "split_group": 2},
            {"product_id": sandwich["id"], "quantity": 1, "split_group": 3},
        ],
        "payments": payments,
    }


def test_each_friend_pays_their_own_share_in_one_sale(client, db: Session) -> None:
    _owner(client, db, "amigos")
    latte, sandwich = _product(client, "Latte", "55.00"), _product(client, "Sándwich", "70.00")
    # $180 − $18 = $162, shared by line: 49.50 + 49.50 + 63.00.
    payments = [
        {"method": "bank_transfer", "amount": "49.50", "split_group": 1},
        {"method": "manual_card", "amount": "49.50", "split_group": 2},
        {"method": "bank_transfer", "amount": "63.00", "split_group": 3},
    ]
    sale = _sell(client, _three_friends(latte, sandwich, payments), key="amigos-1")
    assert sale.status_code == 201, sale.text
    body = sale.json()
    assert body["total_amount"] == "162.00"
    assert sorted((i["split_group"], i["line_total_amount"]) for i in body["items"]) == [
        (1, "49.50"), (2, "49.50"), (3, "63.00")]
    assert sorted((p["split_group"], p["amount_amount"]) for p in body["payments"]) == [
        (1, "49.50"), (2, "49.50"), (3, "63.00")]
    replay = _sell(client, _three_friends(latte, sandwich, payments), key="amigos-1")
    assert replay.json() == body
    assert db.query(Payment).filter(Payment.order_id == UUID(body["id"])).count() == 3

    receipt = client.get(f"/api/v1/orders/{body['id']}/receipt").json()
    assert sorted((i["split_group"], i["product_name"]) for i in receipt["items"]) == [
        (1, "Latte"), (2, "Latte"), (3, "Sándwich")]
    assert {p["split_group"] for p in receipt["payments"]} == {1, 2, 3}
    assert client.get(f"/api/v1/orders/{body['id']}").json()["payments"] == body["payments"]


def test_a_split_must_cover_each_person_exactly(client, db: Session) -> None:
    _owner(client, db, "cuadre")
    latte, sandwich = _product(client, "Latte", "55.00"), _product(client, "Sándwich", "70.00")

    def attempt(payments, **item_overrides):
        body = _three_friends(latte, sandwich, payments)
        for index, group in item_overrides.items():
            body["items"][int(index[1:])]["split_group"] = group
        return _sell(client, body)

    swapped = attempt([
        {"method": "bank_transfer", "amount": "63.00", "split_group": 1},
        {"method": "bank_transfer", "amount": "49.50", "split_group": 2},
        {"method": "bank_transfer", "amount": "49.50", "split_group": 3},
    ])
    assert swapped.status_code == 400
    assert swapped.json()["detail"] == "La persona 1 debe pagar $49.50"

    unassigned = attempt([{"method": "bank_transfer", "amount": "162.00", "split_group": 1}],
                         i2=None)
    assert unassigned.json()["detail"] == "Asigna cada artículo y cada pago a una persona"

    stranger = attempt([
        {"method": "bank_transfer", "amount": "49.50", "split_group": 1},
        {"method": "bank_transfer", "amount": "49.50", "split_group": 2},
        {"method": "bank_transfer", "amount": "63.00", "split_group": 3},
        {"method": "bank_transfer", "amount": "0.00", "split_group": 4},
    ])
    assert stranger.json()["detail"] == "Hay un pago de una persona sin artículos"
    assert db.query(OrderItem).filter(OrderItem.product_id == UUID(latte["id"])).count() == 0


def test_offline_split_sale_syncs_with_its_people(client, db: Session) -> None:
    _owner(client, db, "offline-split")
    latte = _product(client, "Latte", "55.00")
    response = client.post("/api/v1/sync/offline-sales", json={"sales": [{
        "client_uuid": str(uuid4()),
        "order": {
            "items": [{"product_id": latte["id"], "quantity": 1, "split_group": 1},
                      {"product_id": latte["id"], "quantity": 1, "split_group": 2}],
            "payments": [{"method": "bank_transfer", "amount": "55.00", "split_group": 1},
                         {"method": "manual_card", "amount": "55.00", "split_group": 2}],
        },
    }]})
    result = response.json()["results"][0]
    assert result["status"] == "synced", response.text
    assert sorted(p["split_group"] for p in result["order"]["payments"]) == [1, 2]


def test_split_pedido_shares_the_deposit_by_what_each_person_had(client, db: Session) -> None:
    _owner(client, db, "pedido-split")
    order = _cake_order(client, price="300.00", quantity=2)  # two cakes, $600
    order = _deposit(client, order, "150.00", method="bank_transfer").json()
    order = _confirm(client, order).json()
    item = order["items"][0]

    incomplete = _post(client, f"{order['id']}/checkout", {
        "version": order["version"],
        "item_groups": [{"item_id": item["id"], "split_group": 1, "quantity": 1}],
        "payments": [{"method": "manual_card", "amount": "450.00", "split_group": 1}],
    })
    assert incomplete.status_code == 422
    assert incomplete.json()["detail"]["code"] == "SPLIT_INCOMPLETE"

    # Each took one cake ($300); the $150 deposit is shared $75 each, so each pays $225.
    settled = _post(client, f"{order['id']}/checkout", {
        "version": order["version"],
        "item_groups": [{"item_id": item["id"], "split_group": 1, "quantity": 1},
                        {"item_id": item["id"], "split_group": 2, "quantity": 1}],
        "payments": [{"method": "manual_card", "amount": "225.00", "split_group": 1},
                     {"method": "bank_transfer", "amount": "225.00", "split_group": 2}],
    })
    assert settled.status_code == 201, settled.text
    sale = settled.json()["sale_order"]
    assert sale["total_amount"] == "600.00"
    assert sorted((i["split_group"], i["quantity"], i["line_total_amount"])
                  for i in sale["items"]) == [(1, 1, "300.00"), (2, 1, "300.00")]
    # The deposit shows as already collected, outside any person.
    assert sorted(((p["split_group"] or 0), p["deposit_applied"], p["amount_amount"])
                  for p in sale["payments"]) == [
        (0, True, "150.00"), (1, False, "225.00"), (2, False, "225.00")]
    assert sum(Decimal(p["amount_amount"]) for p in sale["payments"]) == Decimal("600.00")

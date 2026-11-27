"""A refund returns money; putting the goods back in stock is a separate decision."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.orders import service as order_service
from app.orders.models import RefundItem
from app.orders.schemas import RefundCreate
from app.tests.test_refund_inventory_integrity import (
    _create_cash_order,
    _open_shift,
    _order_movements,
    _seed_stock,
    _signup_verify_login,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _product(client, *, label: str, cost: str | None = "4.00", lots: bool = False) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"{label}-product-{uuid4().hex}"},
        json={
            "name": f"{label} pan",
            "price_amount": "10.00",
            "cost_price": cost,
            "track_inventory": True,
            **({"track_lots": True} if lots else {}),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _sale(client, product: dict, *, quantity: int, label: str) -> dict:
    total = str(Decimal("10.00") * quantity)
    return _create_cash_order(
        client,
        items=[{"product_id": product["id"], "quantity": quantity}],
        amount=total,
        label=label,
    )


def _refund(client, order: dict, items: list[dict], *, key: str | None = None):
    return client.post(
        f"/api/v1/orders/{order['id']}/refunds",
        headers={"Idempotency-Key": key or f"refund-{uuid4().hex}"},
        json={"items": items, "reason": "defective", "refund_payment_method": "cash"},
    )


def _stock(client, product_id: str) -> int:
    rows = client.get("/api/v1/inventory/stock").json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    return next(row["stock_on_hand"] for row in rows if row["product_id"] == product_id)


def test_refund_without_restock_returns_money_but_keeps_units_out_of_stock(client, db):
    signup = _signup_verify_login(client, label="no-restock")
    _open_shift(client, label="no-restock")
    product = _product(client, label="no-restock")
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=2, label="no-restock")
    line = order["items"][0]["id"]

    response = _refund(client, order, [{"order_item_id": line, "quantity": 1, "restock": False}])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["refunded_amount"] == "10.00"
    assert body["items"][0]["restocked_quantity"] == 0
    assert _order_movements(
        db, tenant_id=signup["tenant_id"], order_id=order["id"], product_id=product["id"]
    ) == [-2]
    assert _stock(client, product["id"]) == 3

    receipt = client.get(f"/api/v1/orders/{order['id']}/receipt").json()
    assert receipt["refunds"][0]["items"][0]["restocked_quantity"] == 0

    waste = client.get("/api/v1/reports/business-story").json()["waste"]
    assert waste["refunds_not_restocked"] == {
        "units": 1,
        "value": "4.00",
        "known_value": "4.00",
        "units_without_cost": 0,
        "complete": True,
    }
    # Typed waste movements keep their own, unchanged definition.
    assert waste["units"] == 0


def test_restock_and_omitted_flag_restore_the_units(client, db):
    signup = _signup_verify_login(client, label="restock")
    _open_shift(client, label="restock")
    product = _product(client, label="restock")
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=3, label="restock")
    line = order["items"][0]["id"]

    explicit = _refund(client, order, [{"order_item_id": line, "quantity": 1, "restock": True}])
    legacy = _refund(client, order, [{"order_item_id": line, "quantity": 1}])

    assert explicit.status_code == legacy.status_code == 201
    assert explicit.json()["items"][0]["restocked_quantity"] == 1
    assert legacy.json()["items"][0]["restocked_quantity"] == 1
    assert _order_movements(
        db, tenant_id=signup["tenant_id"], order_id=order["id"], product_id=product["id"]
    ) == [-3, 1, 1]
    assert _stock(client, product["id"]) == 4
    waste = client.get("/api/v1/reports/business-story").json()["waste"]
    assert waste["refunds_not_restocked"]["units"] == 0


def test_omitted_restock_keeps_the_idempotency_hash_of_older_clients():
    legacy = RefundCreate.model_validate(
        {
            "items": [{"order_item_id": str(uuid4()), "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        }
    )
    dumped = legacy.model_dump(mode="json", exclude_none=True)
    assert "restock" not in dumped["items"][0]
    assert order_service._hash_payload(dumped) == order_service._hash_payload(
        {
            "items": [{"order_item_id": dumped["items"][0]["order_item_id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        }
    )


def test_retry_replays_without_a_second_refund_and_rejects_a_changed_choice(client, db):
    signup = _signup_verify_login(client, label="restock-retry")
    _open_shift(client, label="restock-retry")
    product = _product(client, label="restock-retry")
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=2, label="restock-retry")
    line = order["items"][0]["id"]
    key = f"restock-retry-{uuid4().hex}"
    items = [{"order_item_id": line, "quantity": 1, "restock": False}]

    first = _refund(client, order, items, key=key)
    replay = _refund(client, order, items, key=key)
    changed = _refund(
        client, order, [{"order_item_id": line, "quantity": 1, "restock": True}], key=key
    )

    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]
    assert changed.status_code == 400, changed.text  # key reused with another body
    assert db.query(RefundItem).filter(RefundItem.tenant_id == UUID(signup["tenant_id"])).count() == 1
    assert _stock(client, product["id"]) == 3


def test_conflicting_choices_for_the_same_line_are_rejected(client):
    _signup_verify_login(client, label="restock-conflict")
    _open_shift(client, label="restock-conflict")
    product = _product(client, label="restock-conflict")
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=2, label="restock-conflict")
    line = order["items"][0]["id"]

    response = _refund(
        client,
        order,
        [
            {"order_item_id": line, "quantity": 1, "restock": True},
            {"order_item_id": line, "quantity": 1, "restock": False},
        ],
    )

    assert response.status_code == 400, response.text
    assert _stock(client, product["id"]) == 3


def test_unknown_sale_cost_is_reported_as_incomplete_not_zero(client):
    _signup_verify_login(client, label="restock-nocost")
    _open_shift(client, label="restock-nocost")
    product = _product(client, label="restock-nocost", cost=None)
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=1, label="restock-nocost")

    response = _refund(
        client,
        order,
        [{"order_item_id": order["items"][0]["id"], "quantity": 1, "restock": False}],
    )

    assert response.status_code == 201, response.text
    unrestocked = client.get("/api/v1/reports/business-story").json()["waste"][
        "refunds_not_restocked"
    ]
    assert unrestocked["units"] == 1
    assert unrestocked["value"] is None
    assert unrestocked["units_without_cost"] == 1
    assert unrestocked["complete"] is False


def test_other_tenant_never_sees_unrestocked_refunds(client):
    _signup_verify_login(client, label="restock-owner")
    _open_shift(client, label="restock-owner")
    product = _product(client, label="restock-owner")
    _seed_stock(client, product_id=product["id"], quantity=5)
    order = _sale(client, product, quantity=1, label="restock-owner")
    assert _refund(
        client,
        order,
        [{"order_item_id": order["items"][0]["id"], "quantity": 1, "restock": False}],
    ).status_code == 201

    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _signup_verify_login(client, label="restock-other")
    waste = client.get("/api/v1/reports/business-story").json()["waste"]
    assert waste["refunds_not_restocked"]["units"] == 0


def test_order_read_says_which_lines_left_stock(client):
    _signup_verify_login(client, label="restock-consumed")
    _open_shift(client, label="restock-consumed")
    tracked = _product(client, label="restock-consumed")
    _seed_stock(client, product_id=tracked["id"], quantity=5)
    service = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"service-{uuid4().hex}"},
        json={"name": "Empaque", "price_amount": "10.00", "track_inventory": False},
    ).json()
    order = _create_cash_order(
        client,
        items=[
            {"product_id": tracked["id"], "quantity": 1},
            {"product_id": service["id"], "quantity": 1},
        ],
        amount="20.00",
        label="restock-consumed",
    )

    lines = client.get(f"/api/v1/orders/{order['id']}").json()["items"]

    consumed = {line["product_id"]: line["stock_consumed"] for line in lines}
    assert consumed == {tracked["id"]: True, service["id"]: False}

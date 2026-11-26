"""Ingredients are stocked in base units, bought in purchase units and never sold."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.orders.models import OrderItem
from app.tests.test_orders import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _post(client, path: str, body: dict, key: str | None = None):
    return client.post(
        f"/api/v1/{path}", json=body, headers={"Idempotency-Key": key or str(uuid4())}
    )


def _login(client, label: str) -> dict:
    return _signup_verify_login(client, f"{label}-{uuid4().hex}@example.com", label)


def _milk(client, **extra) -> dict:
    response = _post(
        client,
        "catalog/products",
        {
            "name": "Leche entera",
            "price_amount": "0.00",
            "cost_price": "25.00",
            "track_inventory": True,
            "is_sellable": False,
            "stock_unit": "ml",
            "purchase_unit_label": "Litro",
            "purchase_unit_quantity": 1000,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _stock(client, product_id: str) -> int:
    rows = client.get("/api/v1/inventory/stock").json()
    rows = rows["items"] if isinstance(rows, dict) else rows
    return next(row["stock_on_hand"] for row in rows if row["product_id"] == product_id)


def _supplier(client) -> str:
    response = _post(client, "purchasing/suppliers", {"name": "Lácteos del Valle"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_ingredient_keeps_its_units_and_cannot_change_unit_after_movements(client):
    _login(client, "insumo-unidad")
    milk = _milk(client)

    assert milk["is_sellable"] is False
    assert milk["stock_unit"] == "ml"
    assert (milk["purchase_unit_label"], milk["purchase_unit_quantity"]) == ("Litro", 1000)

    half = client.patch(
        f"/api/v1/catalog/products/{milk['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"purchase_unit_label": None},
    )
    assert half.status_code == 400, half.text

    adjusted = _post(
        client,
        f"inventory/products/{milk['id']}/adjustments",
        {"quantity_delta": 750, "reason": "Conteo inicial"},
    )
    assert adjusted.status_code == 201, adjusted.text
    changed = client.patch(
        f"/api/v1/catalog/products/{milk['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"stock_unit": "g"},
    )
    assert changed.status_code == 400, changed.text
    assert _stock(client, milk["id"]) == 750


def test_ingredient_is_never_rung_up_online_but_an_offline_sale_is_kept(client):
    _login(client, "insumo-caja")
    milk = _milk(client, track_inventory=False)

    online = _post(
        client,
        "orders",
        {
            "items": [{"product_id": milk["id"], "quantity": 1}],
            "payments": [{"method": "cash", "amount": "0.00", "amount_tendered": "0.00"}],
        },
    )
    assert online.status_code == 422, online.text
    assert online.json()["detail"]["code"] == "PRODUCT_NOT_SELLABLE"

    client_uuid = str(uuid4())
    offline = client.post(
        "/api/v1/sync/offline-sales",
        json={
            "sales": [
                {
                    "client_uuid": client_uuid,
                    "order": {
                        "items": [{"product_id": milk["id"], "quantity": 1}],
                        "payments": [
                            {"method": "cash", "amount": "0.00", "amount_tendered": "0.00"}
                        ],
                    },
                }
            ]
        },
    )
    assert offline.status_code == 200, offline.text
    assert offline.json()["results"][0]["status"] == "synced"


def test_purchase_units_convert_to_stock_and_value_inventory_per_base_unit(client, db):
    _login(client, "insumo-compra")
    milk = _milk(client)
    supplier = _supplier(client)
    order = _post(
        client,
        "purchasing/orders",
        {
            "supplier_id": supplier,
            "items": [{"product_id": milk["id"], "quantity": 3, "unit_cost": "26.00"}],
        },
    )
    assert order.status_code == 201, order.text
    item = order.json()["items"][0]
    assert (item["units_per_purchase"], item["purchase_unit_label"]) == (1000, "Litro")

    first = _post(
        client,
        f"purchasing/orders/{order.json()['id']}/receive",
        {"items": [{"item_id": item["id"], "quantity": 2}], "update_catalog_cost": True},
    )
    assert first.status_code == 200, first.text
    assert _stock(client, milk["id"]) == 2000

    # A catalog change never rewrites the line already in transit.
    regallon = client.patch(
        f"/api/v1/catalog/products/{milk['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={"purchase_unit_label": "Galón", "purchase_unit_quantity": 4000},
    )
    assert regallon.status_code == 200, regallon.text
    rest = _post(
        client,
        f"purchasing/orders/{order.json()['id']}/receive",
        {"items": [{"item_id": item["id"], "quantity": 1}], "update_catalog_cost": True},
    )
    assert rest.status_code == 200, rest.text
    assert _stock(client, milk["id"]) == 3000

    product = next(
        p for p in client.get("/api/v1/catalog/products").json() if p["id"] == milk["id"]
    )
    # $26 per litre expressed per gallon of 4000 ml.
    assert product["cost_price"] == "104.00"

    valuation = client.get("/api/v1/reports/business-story").json()["inventory_valuation"]
    assert Decimal(valuation["value"]) == Decimal("78.00")


def test_box_purchase_unit_snapshots_cost_per_piece_on_the_sale(client, db):
    account = _login(client, "insumo-caja-pieza")
    soda = _post(
        client,
        "catalog/products",
        {
            "name": "Refresco",
            "price_amount": "20.00",
            "cost_price": "120.00",
            "track_inventory": True,
            "purchase_unit_label": "Caja",
            "purchase_unit_quantity": 12,
        },
    ).json()
    _post(
        client,
        f"inventory/products/{soda['id']}/adjustments",
        {"quantity_delta": 12, "reason": "Caja inicial"},
    )
    _post(client, "shifts", {"opening_cash_amount": "0.00"})
    sale = _post(
        client,
        "orders",
        {
            "items": [{"product_id": soda["id"], "quantity": 1}],
            "payments": [{"method": "cash", "amount": "20.00", "amount_tendered": "20.00"}],
        },
    )
    assert sale.status_code == 201, sale.text
    line = db.get(OrderItem, UUID(sale.json()["items"][0]["id"]))
    assert line.tenant_id == UUID(account["tenant_id"])
    assert line.unit_cost == Decimal("10.00")


def test_replenishment_suggests_whole_purchase_units(client):
    _login(client, "insumo-reposicion")
    milk = _milk(client, low_stock_threshold=500)
    _post(
        client,
        f"inventory/products/{milk['id']}/adjustments",
        {"quantity_delta": 200, "reason": "Conteo"},
    )

    rows = client.get("/api/v1/replenishment").json()
    row = next(r for r in rows if r["product_id"] == milk["id"])

    assert row["suggested_quantity"] == 301
    assert (row["stock_unit"], row["units_per_purchase"]) == ("ml", 1000)
    assert row["purchase_unit_label"] == "Litro"
    assert row["suggested_purchase_quantity"] == 1


def test_ingredients_stay_out_of_menu_quotes_and_customer_orders(client):
    _login(client, "insumo-menu")
    milk = _milk(client, track_inventory=False)

    published = client.put(
        "/api/v1/storefront/settings",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": 0, "enabled": True, "title": "Menú", "product_ids": [milk["id"]]},
    )
    assert published.status_code == 400, published.text

    order = _post(
        client,
        "customer-orders",
        {
            "fulfillment_type": "pickup",
            "items": [{"product_id": milk["id"], "quantity": 1}],
        },
    )
    assert order.status_code in (400, 422), order.text


def test_import_reads_kind_and_unit_columns(client):
    _login(client, "insumo-import")
    content = (
        "nombre,precio,costo,control_inventario,tipo,unidad\n"
        "Harina,0,18.50,si,insumo,g\n"
        "Concha,18,,no,,\n"
        "Azúcar,0,,si,ingrediente,kg\n"
    ).encode()

    preview = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=content,
        headers={"Content-Type": "text/csv"},
    )
    assert preview.status_code == 200, preview.text
    rows = preview.json()["rows"]
    assert rows[0]["normalized"]["is_sellable"] is False
    assert rows[0]["normalized"]["stock_unit"] == "g"
    assert "is_sellable" not in rows[1]["normalized"]
    assert rows[2]["status"] == "error"
    assert set(rows[2]["errors"]) >= {"tipo admite producto o insumo", "unidad admite pza, g o ml"}

from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.orders.models import InventoryMovement
from app.tests.test_refund_inventory_integrity import (
    _create_product,
    _open_shift,
    _seed_stock,
    _signup_verify_login,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def write(client, path, body, key=None, method="POST"):
    return client.request(method, path, json=body, headers={"Idempotency-Key": key or str(uuid4())})


def product_with_lots(client, initial=0):
    tenant = _signup_verify_login(client, label="lots")
    product = _create_product(client, label="Bolsas", price="10.00", track_inventory=True)
    if initial:
        _seed_stock(client, product_id=product["id"], quantity=initial)
    response = write(
        client,
        f"/api/v1/catalog/products/{product['id']}",
        {"track_lots": True, "rotation_days": 14, "expiry_days": 30},
        method="PATCH",
    )
    assert response.status_code == 200, response.text
    _open_shift(client, label="lots")
    return tenant, product


def new_lot(client, product, code, quantity, expires_on="2020-02-01"):
    response = write(
        client,
        f"/api/v1/inventory/products/{product['id']}/lots",
        {"code": code, "manufactured_on": "2020-01-01", "expires_on": expires_on},
    )
    assert response.status_code == 201, response.text
    lot = response.json()
    if quantity:
        response = write(
            client,
            f"/api/v1/inventory/products/{product['id']}/adjustments",
            {
                "quantity_delta": quantity,
                "reason": "Recepción real",
                "lot_allocations": [{"lot_id": lot["id"], "quantity": quantity}],
            },
        )
        assert response.status_code == 201, response.text
    return lot


def sell(client, product, parts, quantity=None, key=None):
    total = quantity or sum(part["quantity"] for part in parts)
    return write(
        client,
        "/api/v1/orders",
        {
            "items": [{"product_id": product["id"], "quantity": total, "lot_allocations": parts}],
            "payments": [
                {
                    "method": "cash",
                    "amount": f"{total * 10}.00",
                    "amount_tendered": f"{total * 10}.00",
                }
            ],
        },
        key,
    )


def stock(client, product):
    response = client.get(f"/api/v1/inventory/products/{product['id']}/lots")
    assert response.status_code == 200
    return {row["id"]: row for row in response.json()}


def test_activation_preserves_unknown_stock_and_confirmed_dates(client, db):
    tenant, product = product_with_lots(client, initial=8)
    rows = stock(client, product)
    unknown = next(iter(rows.values()))
    assert unknown["is_unknown"] and unknown["stock_on_hand"] == 8
    assert unknown["manufactured_on"] is None and unknown["date_status"] == "sin_fecha"
    suggested = client.get(
        f"/api/v1/inventory/products/{product['id']}/lots/suggestions?manufactured_on=2026-01-01"
    )
    assert suggested.json()["rotation_on"] == "2026-01-15"
    assert suggested.json()["expires_on"] == "2026-01-31"
    lot = new_lot(client, product, "Tostado A", 0)
    result = write(
        client,
        f"/api/v1/inventory/products/{product['id']}/lots/reclassify",
        {
            "source_lot_id": unknown["id"],
            "destination_lot_id": lot["id"],
            "quantity": 3,
            "reason": "Etiqueta identificada",
        },
    )
    assert result.status_code == 200, result.text
    rows = stock(client, product)
    assert rows[unknown["id"]]["stock_on_hand"] == 5
    assert rows[lot["id"]]["stock_on_hand"] == 3
    total = (
        db.query(func.sum(InventoryMovement.quantity_delta))
        .filter_by(tenant_id=UUID(tenant["tenant_id"]), product_id=UUID(product["id"]))
        .scalar()
    )
    assert total == 8


def test_sale_spans_lots_expiry_warns_and_replay_never_duplicates(client):
    _, product = product_with_lots(client)
    a = new_lot(client, product, "A", 2)
    b = new_lot(client, product, "B", 6)
    parts = [{"lot_id": a["id"], "quantity": 2}, {"lot_id": b["id"], "quantity": 3}]
    key = str(uuid4())
    sale = sell(client, product, parts, key=key)
    assert sale.status_code == 201, sale.text
    assert sale.json()["items"][0]["lot_tracked"] is True
    assert sell(client, product, parts, key=key).json()["id"] == sale.json()["id"]
    assert stock(client, product)[b["id"]]["stock_on_hand"] == 3
    assert stock(client, product)[b["id"]]["date_status"] == "vencido"
    insufficient = sell(client, product, [{"lot_id": a["id"], "quantity": 1}])
    assert insufficient.status_code == 409


@pytest.mark.parametrize("not_delivered,expected", [(True, 4), (False, 2)])
def test_void_requires_delivery_decision_and_restores_original_lot(client, not_delivered, expected):
    _, product = product_with_lots(client)
    lot = new_lot(client, product, "Original", 4)
    sale = sell(client, product, [{"lot_id": lot["id"], "quantity": 2}]).json()
    missing = write(client, f"/api/v1/orders/{sale['id']}/void", {"reason": "operator_error"})
    assert missing.status_code == 400
    result = write(
        client,
        f"/api/v1/orders/{sale['id']}/void",
        {"reason": "operator_error", "not_delivered": not_delivered},
    )
    assert result.status_code == 201, result.text
    assert stock(client, product)[lot["id"]]["stock_on_hand"] == expected


def test_refund_does_not_restock_even_after_disabling_lots(client):
    _, product = product_with_lots(client)
    lot = new_lot(client, product, "Consumido", 2)
    sale = sell(client, product, [{"lot_id": lot["id"], "quantity": 2}]).json()
    disabled = write(
        client, f"/api/v1/catalog/products/{product['id']}", {"track_lots": False}, method="PATCH"
    )
    assert disabled.status_code == 200
    result = write(
        client,
        f"/api/v1/orders/{sale['id']}/refunds",
        {
            "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        },
    )
    assert result.status_code == 201, result.text
    assert stock(client, product)[lot["id"]]["stock_on_hand"] == 0


def test_bad_allocations_roll_back_and_disabling_with_stock_is_rejected(client):
    _, product = product_with_lots(client)
    lot = new_lot(client, product, "A", 3)
    assert (
        sell(client, product, [{"lot_id": lot["id"], "quantity": 1}], quantity=2).status_code == 400
    )
    assert stock(client, product)[lot["id"]]["stock_on_hand"] == 3
    assert (
        write(
            client,
            f"/api/v1/catalog/products/{product['id']}",
            {"track_lots": False},
            method="PATCH",
        ).status_code
        == 409
    )
    assert (
        write(
            client,
            f"/api/v1/catalog/products/{product['id']}",
            {"track_inventory": False},
            method="PATCH",
        ).status_code
        == 400
    )


def test_stock_take_reconciles_per_lot_even_with_opposite_differences(client):
    _, product = product_with_lots(client)
    a = new_lot(client, product, "A", 3)
    b = new_lot(client, product, "B", 2)
    rows = stock(client, product)
    counts = [
        {
            "lot_id": lot_id,
            "counted_quantity": 1 if lot_id == a["id"] else 4 if lot_id == b["id"] else 0,
        }
        for lot_id in rows
    ]
    result = write(
        client,
        f"/api/v1/inventory/products/{product['id']}/stock-take",
        {"counted_quantity": 5, "reason": "Conteo por etiquetas", "lot_counts": counts},
    )
    assert result.status_code == 201, result.text
    assert stock(client, product)[a["id"]]["stock_on_hand"] == 1
    assert stock(client, product)[b["id"]]["stock_on_hand"] == 4


def test_database_rejects_unallocated_tracked_movement(client, db):
    tenant, product = product_with_lots(client)
    with pytest.raises(IntegrityError):
        db.add(
            InventoryMovement(
                tenant_id=UUID(tenant["tenant_id"]),
                product_id=UUID(product["id"]),
                movement_type="adjustment",
                quantity_delta=3,
            )
        )
        db.flush()
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.rollback()


def test_foreign_lot_is_rejected_without_stock_change(client):
    _, first = product_with_lots(client)
    lot = new_lot(client, first, "Propio", 3)
    second = _create_product(client, label="Otro", price="10.00", track_inventory=True)
    assert (
        write(
            client, f"/api/v1/catalog/products/{second['id']}", {"track_lots": True}, method="PATCH"
        ).status_code
        == 200
    )
    result = write(
        client,
        f"/api/v1/inventory/products/{second['id']}/adjustments",
        {
            "quantity_delta": 1,
            "reason": "Ajeno",
            "lot_allocations": [{"lot_id": lot["id"], "quantity": 1}],
        },
    )
    assert result.status_code == 404
    assert stock(client, first)[lot["id"]]["stock_on_hand"] == 3


def test_reserved_lots_survive_transfer_and_customer_checkout(client):
    tenant, product = product_with_lots(client)
    a = new_lot(client, product, "Reservado", 2)
    b = new_lot(client, product, "Libre", 4, expires_on="2020-03-01")
    order = write(
        client, "/api/v1/customer-orders", {"items": [{"product_id": product["id"], "quantity": 3}]}
    ).json()
    confirmed = write(
        client, f"/api/v1/customer-orders/{order['id']}/confirm", {"version": order["version"]}
    )
    assert confirmed.status_code == 200, confirmed.text
    confirmed = confirmed.json()
    assert sum(p["quantity"] for p in confirmed["lot_reservations"][product["id"]]) == 3
    branch = write(client, "/api/v1/branches", {"name": "Barra", "address": None}).json()
    payload = {
        "source_branch_id": tenant["tenant_id"],
        "destination_branch_id": branch["id"],
        "product_id": product["id"],
        "quantity": 2,
        "reason": "Mover tanda",
    }
    denied = write(
        client,
        "/api/v1/branches/transfers",
        {**payload, "lot_allocations": [{"lot_id": a["id"], "quantity": 2}]},
    )
    assert denied.status_code == 409
    transferred = write(
        client,
        "/api/v1/branches/transfers",
        {**payload, "lot_allocations": [{"lot_id": b["id"], "quantity": 2}]},
    )
    assert transferred.status_code == 201, transferred.text
    checkout = write(
        client,
        f"/api/v1/customer-orders/{order['id']}/checkout",
        {
            "version": confirmed["version"],
            "payments": [{"method": "cash", "amount": "30.00", "amount_tendered": "30.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["sale_order"]["items"][0]["lot_tracked"]
    target = client.get(
        f"/api/v1/inventory/products/{product['id']}/lots", headers={"X-Kova-Branch": branch["id"]}
    ).json()
    target_b = next(row for row in target if row["id"] == b["id"])
    assert target_b["stock_on_hand"] == 2 and target_b["manufactured_on"] == "2020-01-01"


def test_physical_loss_marks_reservation_conflict_and_explicit_reassignment_resolves_it(client):
    _, product = product_with_lots(client)
    a = new_lot(client, product, "A", 2)
    b = new_lot(client, product, "B", 4, expires_on="2020-03-01")
    order = write(
        client, "/api/v1/customer-orders", {"items": [{"product_id": product["id"], "quantity": 2}]}
    ).json()
    confirmed = write(
        client, f"/api/v1/customer-orders/{order['id']}/confirm", {"version": order["version"]}
    ).json()
    reserved = confirmed["lot_reservations"][product["id"]]
    damaged = reserved[0]["lot_id"]
    result = write(
        client,
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        {
            "quantity_delta": -1,
            "reason": "Envase dañado",
            "reason_code": "daño",
            "lot_allocations": [{"lot_id": damaged, "quantity": 1}],
        },
    )
    assert result.status_code == 201, result.text
    assert client.get(f"/api/v1/customer-orders/{order['id']}").json()["stock_conflict"] is True
    payload = {
        "version": confirmed["version"],
        "payments": [{"method": "cash", "amount": "20.00", "amount_tendered": "20.00"}],
    }
    assert (
        write(client, f"/api/v1/customer-orders/{order['id']}/checkout", payload).status_code == 422
    )
    free = b if damaged == a["id"] else a
    resolved = write(
        client,
        f"/api/v1/customer-orders/{order['id']}/checkout",
        {**payload, "lot_allocations": {product["id"]: [{"lot_id": free["id"], "quantity": 2}]}},
    )
    assert resolved.status_code == 201, resolved.text


def test_legacy_offline_requires_review_and_keeps_idempotent_identity(client):
    _, product = product_with_lots(client, initial=3)
    unknown = next(row for row in stock(client, product).values() if row["is_unknown"])
    client_uuid = str(uuid4())
    order = {
        "items": [{"product_id": product["id"], "quantity": 1}],
        "payments": [{"method": "bank_transfer", "amount": "10.00"}],
    }
    original = {"client_uuid": client_uuid, "order": order}
    first = client.post("/api/v1/sync/offline-sales", json={"sales": [original]})
    assert first.json()["results"][0]["status"] == "failed"
    reconciled = {
        **original,
        "lot_reconciliation": {product["id"]: [{"lot_id": unknown["id"], "quantity": 1}]},
    }
    result = client.post("/api/v1/sync/offline-sales", json={"sales": [reconciled]}).json()[
        "results"
    ][0]
    assert result["status"] == "synced", result
    replay = client.post("/api/v1/sync/offline-sales", json={"sales": [reconciled]}).json()[
        "results"
    ][0]
    assert replay["order_id"] == result["order_id"]
    assert stock(client, product)[unknown["id"]]["stock_on_hand"] == 2


def test_offline_never_accepts_substituting_original_lots(client):
    _, product = product_with_lots(client)
    a = new_lot(client, product, "A", 1)
    b = new_lot(client, product, "B", 1)
    original = {
        "client_uuid": str(uuid4()),
        "order": {
            "items": [
                {
                    "product_id": product["id"],
                    "quantity": 1,
                    "lot_allocations": [{"lot_id": a["id"], "quantity": 1}],
                }
            ],
            "payments": [{"method": "bank_transfer", "amount": "10.00"}],
        },
        "lot_reconciliation": {product["id"]: [{"lot_id": b["id"], "quantity": 1}]},
    }
    response = client.post("/api/v1/sync/offline-sales", json={"sales": [original]}).json()[
        "results"
    ][0]
    assert response["status"] == "failed"
    assert stock(client, product)[a["id"]]["stock_on_hand"] == 1


def test_activation_backfills_each_branch_without_moving_units(client):
    tenant = _signup_verify_login(client, label="branch-activation")
    product = _create_product(client, label="Antes de lotes", price="10.00", track_inventory=True)
    _seed_stock(client, product_id=product["id"], quantity=6)
    branch = write(client, "/api/v1/branches", {"name": "Segunda", "address": None}).json()
    transfer = write(client, "/api/v1/branches/transfers", {"source_branch_id": tenant["tenant_id"],
        "destination_branch_id": branch["id"], "product_id": product["id"], "quantity": 2, "reason": "Distribución inicial"})
    assert transfer.status_code == 201, transfer.text
    enabled = write(client, f"/api/v1/catalog/products/{product['id']}", {"track_lots": True}, method="PATCH")
    assert enabled.status_code == 200, enabled.text
    main = next(iter(stock(client, product).values()))
    other = client.get(f"/api/v1/inventory/products/{product['id']}/lots", headers={"X-Kova-Branch": branch["id"]}).json()[0]
    assert main["id"] == other["id"]
    assert main["stock_on_hand"] == 4 and other["stock_on_hand"] == 2


def test_snapshot_acknowledges_exact_offline_sale_and_preserves_trace_after_void(client):
    _, product = product_with_lots(client)
    lot = new_lot(client, product, "Traza original", 2)
    client_uuid = str(uuid4())
    sale = {"client_uuid": client_uuid, "order": {"items": [{"product_id": product["id"], "quantity": 1,
        "lot_allocations": [{"lot_id": lot["id"], "quantity": 1}]}], "payments": [{"method": "bank_transfer", "amount": "10.00"}]}}
    synced = client.post("/api/v1/sync/offline-sales", json={"sales": [sale]}).json()["results"][0]
    assert synced["status"] == "synced"
    snapshot = client.post("/api/v1/inventory/lots/snapshot", json={"client_uuids": [client_uuid, str(uuid4())]})
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["applied_client_uuids"] == [client_uuid]
    assert next(row for row in snapshot.json()["lots"] if row["id"] == lot["id"])["stock_on_hand"] == 1
    void = write(client, f"/api/v1/orders/{synced['order_id']}/void", {"reason": "operator_error", "not_delivered": True})
    assert void.status_code == 201, void.text
    detail = client.get(f"/api/v1/orders/{synced['order_id']}").json()
    assert detail["items"][0]["lot_allocations"] == [{"lot_id": lot["id"], "quantity": 1, "code": "Traza original"}]


def test_runtime_can_correct_lot_metadata_but_cannot_rewrite_identity_or_movements(
    client, db, kova_app_engine
):
    tenant, product = product_with_lots(client)
    lot = new_lot(client, product, "Original", 2)
    db.execute(text("SELECT set_config('app.tenant_id', :tenant, true)"),
               {"tenant": tenant["tenant_id"]})
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        corrected = db.execute(
            text("UPDATE inventory_lots SET code='Corregido' WHERE id=:id RETURNING code"),
            {"id": lot["id"]},
        ).scalar_one()
        assert corrected == "Corregido"
        for sql in (
            "UPDATE inventory_lots SET is_unknown=true WHERE id=:id",
            "UPDATE inventory_lots SET product_id=product_id WHERE id=:id",
            "UPDATE inventory_lots SET tenant_id=tenant_id WHERE id=:id",
            "UPDATE inventory_lot_allocations SET quantity_delta=3 WHERE lot_id=:id",
            "DELETE FROM inventory_lot_allocations WHERE lot_id=:id",
        ):
            with pytest.raises(DBAPIError, match="permission denied"):
                with db.begin_nested():
                    db.execute(text(sql), {"id": lot["id"]})
        db.execute(text("SELECT set_config('app.tenant_id', :tenant, true)"),
                   {"tenant": str(uuid4())})
        assert db.execute(text("SELECT id FROM inventory_lots")).all() == []
        assert db.execute(text("SELECT id FROM inventory_lot_allocations")).all() == []
    finally:
        db.execute(text("RESET ROLE"))


def test_two_concurrent_sales_cannot_consume_the_same_last_lot(owner_engine):
    from concurrent.futures import ThreadPoolExecutor
    from datetime import UTC, datetime
    from decimal import Decimal

    from sqlalchemy.orm import Session

    from app.auth.models import User
    from app.catalog.models import Product
    from app.db import set_tenant_context
    from app.inventory.models import InventoryLot, InventoryLotAllocation
    from app.orders.schemas import OrderCreate
    from app.orders.service import create_order
    from app.tenants.models import Tenant

    tenant_id, product_id, user_id, lot_id = (uuid4() for _ in range(4))
    # Committed setup is necessary: independent connections cannot see the
    # normal client's transactional test fixture.
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrency", slug=str(tenant_id)))
        seed.add(
            User(
                id=user_id,
                email=f"{user_id}@example.com",
                hashed_password="test-only",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        seed.flush()
        seed.add(
            Product(
                id=product_id,
                tenant_id=tenant_id,
                name="Última bolsa",
                price_amount=Decimal("10.00"),
                track_inventory=True,
                track_lots=True,
            )
        )
        seed.flush()
        seed.add(InventoryLot(id=lot_id, tenant_id=tenant_id, product_id=product_id, code="Última"))
        movement = InventoryMovement(
            tenant_id=tenant_id,
            product_id=product_id,
            movement_type="adjustment",
            quantity_delta=1,
            lot_tracked=True,
        )
        seed.add(movement)
        seed.flush()
        seed.add(
            InventoryLotAllocation(
                tenant_id=tenant_id,
                product_id=product_id,
                branch_id=tenant_id,
                movement_id=movement.id,
                lot_id=lot_id,
                quantity_delta=1,
            )
        )
        seed.commit()
    body = OrderCreate(
        items=[
            {
                "product_id": product_id,
                "quantity": 1,
                "lot_allocations": [{"lot_id": lot_id, "quantity": 1}],
            }
        ],
        payments=[{"method": "bank_transfer", "amount": "10.00"}],
    )

    def sale_once(_):
        from fastapi import HTTPException

        with Session(owner_engine) as session:
            set_tenant_context(session, tenant_id)
            try:
                return create_order(
                    session,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    body=body,
                    idempotency_key=str(uuid4()),
                )[0]
            except HTTPException as exc:
                session.rollback()
                return exc.status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(sale_once, range(2)))
        assert statuses.count(201) == 1
        with owner_engine.connect() as connection:
            assert (
                connection.execute(
                    text(
                        "SELECT sum(quantity_delta) FROM inventory_lot_allocations WHERE tenant_id=:id"
                    ),
                    {"id": tenant_id},
                ).scalar()
                == 0
            )
    finally:
        from app.account_lifecycle.service import _TENANT_DELETE_ORDER

        with owner_engine.begin() as connection:
            connection.execute(
                text("SELECT set_config('app.allow_fiscal_history_delete', 'on', true)")
            )
            for table in _TENANT_DELETE_ORDER:
                connection.execute(
                    text(f'DELETE FROM "{table}" WHERE tenant_id=:id'), {"id": tenant_id}
                )
            connection.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant_id})
            connection.execute(text("DELETE FROM users WHERE id=:id"), {"id": user_id})

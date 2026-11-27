"""Preparation queue: counter sales by station with a daily number, and pedidos with their status."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.prep_queue.models import PrepTicket
from app.tests.test_customer_order_deposits import _as_role, _owner, _post
from app.tests.test_customer_orders import _confirm, _create, _seed

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _station(client, name: str, minutes: int = 8) -> dict:
    response = client.post("/api/v1/prep-stations", json={"name": name, "alert_minutes": minutes})
    assert response.status_code == 201, response.text
    return response.json()


def _product(client, name: str, price: str, station: dict | None = None, **extra) -> dict:
    body = {"name": name, "price_amount": price, **extra}
    if station:
        body["prep_station_id"] = station["id"]
    response = client.post("/api/v1/catalog/products", json=body,
                           headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 201, response.text
    return response.json()


def _sell(client, *lines: tuple[dict, int]) -> dict:
    total = sum(float(product["price_amount"]) * quantity for product, quantity in lines)
    response = client.post("/api/v1/orders", headers={"Idempotency-Key": str(uuid4())}, json={
        "items": [{"product_id": product["id"], "quantity": quantity} for product, quantity in lines],
        "payments": [{"method": "bank_transfer", "amount": f"{total:.2f}"}],
    })
    assert response.status_code == 201, response.text
    return response.json()


def _queue(client) -> dict:
    response = client.get("/api/v1/prep-queue")
    assert response.status_code == 200, response.text
    return response.json()


def _move(client, card: dict, status: str, version: int | None = None):
    return client.post(f"/api/v1/prep-queue/tickets/{card['id']}/status",
                       json={"version": version or card["version"], "status": status})


def test_counter_sale_goes_to_each_station_with_one_daily_number(client, db: Session) -> None:
    _owner(client, db, "cafe")
    bar, kitchen = _station(client, "Barra"), _station(client, "Cocina", 12)
    latte = _product(client, "Latte", "55.00", bar)
    sandwich = _product(client, "Sándwich", "70.00", kitchen)
    cookie = _product(client, "Galleta", "20.00")

    first = _sell(client, (latte, 2), (sandwich, 1), (cookie, 1))
    second = _sell(client, (latte, 1))
    _sell(client, (cookie, 3))  # nothing to prepare: no ticket and no number

    cards = _queue(client)["cards"]
    assert sorted((c["number"], c["station_id"], c["status"]) for c in cards) == sorted([
        (1, bar["id"], "received"), (1, kitchen["id"], "received"), (2, bar["id"], "received")])
    first_bar = next(c for c in cards if c["number"] == 1 and c["station_id"] == bar["id"])
    assert first_bar["items"] == [
        {"product_name": "Latte", "quantity": 2, "modifiers": [], "note": None}]
    first_kitchen = next(c for c in cards if c["station_id"] == kitchen["id"])
    assert [i["product_name"] for i in first_kitchen["items"]] == ["Sándwich"]

    receipt = client.get(f"/api/v1/orders/{first['id']}/receipt").json()
    assert receipt["prep_number"] == 1
    assert client.get(f"/api/v1/orders/{second['id']}/receipt").json()["prep_number"] == 2


def test_cashier_moves_forward_and_only_a_manager_corrects(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "flujo")
    bar = _station(client, "Barra")
    latte = _product(client, "Latte", "55.00", bar)
    _sell(client, (latte, 1))
    _as_role(client, db, tenant_id, email, "cashier")

    card = _queue(client)["cards"][0]
    started = _move(client, card, "preparing")
    assert started.status_code == 200, started.text
    assert started.json()["preparing_at"] is not None
    stale = _move(client, card, "ready")  # still holds the first version
    assert stale.status_code == 409
    again = _move(client, card, "preparing")  # retry of what already happened
    assert again.status_code == 200 and again.json()["version"] == started.json()["version"]

    ready = _move(client, {**card, "version": started.json()["version"]}, "ready").json()
    delivered = _move(client, {**card, "version": ready["version"]}, "delivered").json()
    assert delivered["status"] == "delivered"
    assert _queue(client)["cards"][0]["status"] == "delivered"  # stays briefly to correct

    back = _move(client, {**card, "version": delivered["version"]}, "ready")
    assert back.status_code == 403
    _as_role(client, db, tenant_id, email, "manager")
    corrected = _move(client, {**card, "version": delivered["version"]}, "ready")
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["delivered_at"] is None
    assert db.query(AuditLog).filter(AuditLog.action == "prep.ticket.reopen").count() == 1


def test_voided_sale_leaves_the_queue(client, db: Session) -> None:
    _owner(client, db, "anulada")
    latte = _product(client, "Latte", "55.00", _station(client, "Barra"))
    sale = _sell(client, (latte, 1))
    voided = client.post(f"/api/v1/orders/{sale['id']}/void", json={"reason": "operator_error"},
                         headers={"Idempotency-Key": str(uuid4())})
    assert voided.status_code == 201, voided.text
    assert _queue(client)["cards"] == []
    ticket = db.query(PrepTicket).filter(PrepTicket.order_id == UUID(sale["id"])).one()
    assert ticket.status == "cancelled"


def test_offline_sale_synced_late_is_not_queued(client, db: Session) -> None:
    _owner(client, db, "offline")
    latte = _product(client, "Latte", "55.00", _station(client, "Barra"))

    def sync(minutes_ago: int) -> None:
        occurred = (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat()
        response = client.post("/api/v1/sync/offline-sales", json={"sales": [{
            "client_uuid": str(uuid4()), "occurred_at": occurred,
            "order": {"items": [{"product_id": latte["id"], "quantity": 1}],
                      "payments": [{"method": "bank_transfer", "amount": "55.00"}]},
        }]})
        assert response.json()["results"][0]["status"] == "synced", response.text

    sync(90)
    assert _queue(client)["cards"] == []
    sync(5)
    assert len(_queue(client)["cards"]) == 1


def test_stations_are_named_once_and_inactive_ones_stop_queueing(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "estaciones")
    bar = _station(client, "Barra")
    assert client.post("/api/v1/prep-stations", json={"name": " barra "}).status_code == 409
    latte = _product(client, "Latte", "55.00", bar)
    off = client.patch(f"/api/v1/prep-stations/{bar['id']}", json={"is_active": False})
    assert off.status_code == 200, off.text
    _sell(client, (latte, 1))
    assert _queue(client)["cards"] == []
    rejected = client.post("/api/v1/catalog/products", headers={"Idempotency-Key": str(uuid4())},
                           json={"name": "Moka", "price_amount": "60.00",
                                 "prep_station_id": bar["id"]})
    assert rejected.status_code == 400
    _as_role(client, db, tenant_id, email, "cashier")
    assert client.post("/api/v1/prep-stations", json={"name": "Cocina"}).status_code == 403


def test_customer_orders_show_their_own_status_and_wait_for_their_day(
    client, db: Session
) -> None:
    _owner(client, db, "pedidos")
    kitchen = _station(client, "Cocina")
    cake = _product(client, "Pastel", "300.00", kitchen, track_inventory=True)
    _seed(client, cake["id"], 5)
    today = _confirm(client, _create(client, cake["id"], quantity=1).json()).json()
    tomorrow = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    later = client.post("/api/v1/customer-orders", headers={"Idempotency-Key": str(uuid4())}, json={
        "fulfillment_type": "pickup", "source_channel": "counter", "customer_name": "Ana",
        "promised_at": tomorrow,
        "items": [{"product_id": cake["id"], "quantity": 1, "modifier_option_ids": []}],
    })
    assert later.status_code == 201, later.text
    assert _confirm(client, later.json()).status_code == 200

    cards = _queue(client)["cards"]
    assert [(c["kind"], c["folio"], c["status"], c["payment_status"]) for c in cards] == [
        ("customer_order", today["folio"], "received", "unpaid")]
    moved = _post(client, f"{today['id']}/status",
                  {"version": today["version"], "status": "in_progress"})
    assert moved.status_code == 200, moved.text
    assert _queue(client)["cards"][0]["status"] == "preparing"
    # Pedido cards change through Pedidos, never through a ticket.
    assert _move(client, _queue(client)["cards"][0], "ready").status_code == 404


def test_other_business_cannot_see_or_move_tickets(client, db: Session) -> None:
    _owner(client, db, "negocio-a")
    latte = _product(client, "Latte", "55.00", _station(client, "Barra"))
    _sell(client, (latte, 1))
    card = _queue(client)["cards"][0]
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _owner(client, db, "negocio-b")
    assert _queue(client)["cards"] == []
    assert _move(client, card, "preparing").status_code == 404

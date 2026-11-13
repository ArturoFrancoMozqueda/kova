from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.appointments import service as agenda
from app.appointments.models import Appointment
from app.appointments.schemas import AppointmentResourceCreate
from app.bookings import service, tables
from app.bookings.models import TableReservation, TableReservationHistory
from app.bookings.schemas import AvailabilityWrite, PageWrite, TableAction, TableRequestWrite
from app.branches.scope import bind_branch
from app.config import settings
from app.customers.models import Customer
from app.db import set_tenant_context
from app.tests.test_crm import setup
from app.tests.test_public_bookings import BASE, PUBLIC, write

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def configure(client, *, zone="America/Mexico_City"):
    account, customer = setup(client)
    response = client.post(
        BASE + "/resources",
        json={
            "name": "Mesa 1",
            "timezone": zone,
            "kind": "table",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    resource = response.json()
    write(
        client,
        f"/availability/{resource['id']}",
        {
            "expected_version": 0,
            "weekly": [
                {"weekday": i, "windows": [{"start": "09:00", "end": "20:00"}]} for i in range(7)
            ],
            "exceptions": [],
        },
    )
    page = write(
        client,
        "/booking-page",
        {
            "expected_version": 0,
            "enabled": True,
            "mode": "tables",
        },
    )
    token = page["share_path"].split("/")[-1]
    day = datetime.now(ZoneInfo(zone)).date() + timedelta(days=2)
    response = client.get(PUBLIC + "/table-arrivals", params={"page_token": token, "day": str(day)})
    assert response.status_code == 200, response.text
    slots = response.json()["items"]
    body = {
        "page_token": token,
        "starts_at": slots[0]["starts_at"],
        "name": customer["name"],
        "phone": customer["phone"],
        "party_size": 3,
    }
    return account, customer, resource, page, slots, body


def request(client, body, key=None):
    return client.post(
        PUBLIC + "/table-requests",
        json=body,
        headers={"Origin": settings.frontend_url, "Idempotency-Key": key or str(uuid4())},
    )


def action(client, row, action, *, resource=None, key=None):
    return client.post(
        BASE + f"/table-reservations/{row['id']}/action",
        json={
            "expected_version": row["version"],
            "action": action,
            **({"resource_id": resource["id"]} if resource else {}),
        },
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def listing(client):
    response = client.get(BASE + "/table-reservations")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_table_request_is_pending_without_duration_occupancy_or_phone_identity(client, db):
    _, customer, r, _, _, body = configure(client)
    before = db.query(Customer).count()
    key = str(uuid4())
    response = request(client, body, key)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert receipt["status"] == "requested" and receipt["resource_name"] is None
    assert "ends_at" not in receipt and "phone" not in receipt and "id" not in receipt
    assert request(client, body, key).json() == receipt
    assert request(client, {**body, "party_size": 4}, key).status_code == 409
    assert db.query(Customer).count() == before
    assert db.query(Appointment).count() == 0
    row = db.query(TableReservation).one()
    assert row.customer_id is None and row.resource_id is None
    assert row.phone == customer["phone"]
    # Another request for that arrival is received for review, not auto-confirmed.
    assert request(client, {**body, "name": "Otra familia"}).status_code == 201
    first, second = listing(client)
    confirmed = action(client, first, "confirm", resource=r, key=(confirm_key := str(uuid4())))
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert action(client, first, "confirm", resource=r, key=confirm_key).json() == confirmed.json()
    assert action(client, second, "confirm", resource=r).status_code == 409
    assert action(client, first, "decline").status_code == 409
    row = confirmed.json()
    assert row["history"][0]["action"] == "confirm"
    calendar = client.get(
        BASE + "/calendar",
        params={
            "starts_from": body["starts_at"],
            "starts_until": (
                datetime.fromisoformat(body["starts_at"]) + timedelta(hours=1)
            ).isoformat(),
        },
    ).json()["items"]
    assert len(calendar) == 2 and all(
        e["source"] == "table" and e["ends_at"] is None for e in calendar
    )


def test_public_reprogramming_removes_confirmation_and_retries_do_not_duplicate(client, db):
    _, _, r, _, slots, body = configure(client)
    receipt = request(client, body).json()
    row = listing(client)[0]
    assert action(client, row, "confirm", resource=r).status_code == 200
    token = receipt["manage_path"].split("#")[1]
    payload = {
        "token": token,
        "expected_version": 2,
        "action": "reschedule",
        "starts_at": slots[1]["starts_at"],
    }
    key = str(uuid4())
    changed = client.post(PUBLIC + "/table-manage", json=payload, headers={"Idempotency-Key": key})
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "requested" and changed.json()["resource_name"] is None
    assert (
        client.post(PUBLIC + "/table-manage", json=payload, headers={"Idempotency-Key": key}).json()
        == changed.json()
    )
    assert db.query(TableReservation).count() == 1
    assert db.query(TableReservationHistory).count() == 3
    assert (
        client.post(
            PUBLIC + "/table-manage",
            json={"token": token, "expected_version": 2, "action": "cancel"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 409
    )
    assert (
        client.post(
            PUBLIC + "/table-manage",
            json={"token": token, "expected_version": 3, "action": "cancel"},
            headers={"Idempotency-Key": str(uuid4())},
        ).json()["status"]
        == "cancelled"
    )


def test_tables_require_explicit_schedules_and_cannot_be_used_as_duration_services(client, db):
    _, _, r, page, _, body = configure(client)
    assert (
        client.post(
            BASE + "/services",
            json={"name": "Falsa cita de mesa", "duration_minutes": 60, "resource_ids": [r["id"]]},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 400
    )
    write(
        client, f"/availability/{r['id']}", {"expected_version": 1, "weekly": [], "exceptions": []}
    )
    assert client.get(
        PUBLIC + "/table-arrivals",
        params={"page_token": body["page_token"], "day": body["starts_at"][:10]},
    ).json() == {"items": []}
    assert request(client, body).status_code == 409
    assert (
        client.put(
            BASE + "/booking-page",
            json={"expected_version": page["version"], "enabled": True, "mode": "tables"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 400
    )
    assert db.query(TableReservation).count() == 0


def test_table_private_links_have_own_audience_expiry_revocation_and_cutoff(client, db):
    _, _, _, page, _, body = configure(client)
    receipt = request(client, body).json()
    token = receipt["manage_path"].split("#")[1]

    def read(value):
        return client.post(PUBLIC + "/table-manage/read", json={"token": value})

    assert read(token).status_code == 200
    assert client.post(PUBLIC + "/manage/read", json={"token": token}).status_code == 404
    assert read(body["page_token"]).status_code == 404
    claims = jwt.decode(token, options={"verify_signature": False})
    assert (
        read(jwt.encode({**claims, "exp": 1}, settings.secret_key, algorithm="HS256")).status_code
        == 404
    )
    write(client, "/booking-page", {"expected_version": page["version"], "enabled": False})
    assert read(token).status_code == 200
    assert request(client, body).status_code == 404
    row = listing(client)[0]
    assert action(client, row, "revoke").status_code == 200
    assert read(token).status_code == 404
    with db.begin_nested():
        current = db.query(TableReservation).one()
        current.starts_at = datetime.now(UTC) + timedelta(hours=1)
        db.flush()
        assert not tables.receipt(db, service._page(db, current.tenant_id), current)["can_manage"]


def test_actual_occupancy_requires_release_and_records_real_times(client, db, monkeypatch):
    _, _, r, _, slots, body = configure(client)
    request(client, body)
    request(client, {**body, "starts_at": slots[1]["starts_at"], "name": "Segunda familia"})
    a, b = listing(client)
    a = action(client, a, "confirm", resource=r).json()
    b = action(client, b, "confirm", resource=r).json()
    # A later arrival is reviewed manually, without inventing a departure time.
    review = client.get(
        BASE + f"/table-reservations/{b['id']}/review", params={"resource_id": r["id"]}
    ).json()
    assert [v["id"] for v in review["items"]] == [a["id"]]
    assert action(client, a, "seat").status_code == 409
    stamp = datetime.fromisoformat(slots[2]["starts_at"])

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return stamp.astimezone(tz or UTC)

    monkeypatch.setattr(tables, "datetime", Clock)
    a = action(client, a, "seat").json()
    assert a["status"] == "seated" and a["seated_at"] is not None and a["released_at"] is None
    assert action(client, b, "seat").status_code == 409
    a = action(client, a, "release").json()
    assert a["status"] == "completed" and a["released_at"] is not None
    assert action(client, b, "seat").status_code == 200


def test_private_table_scope_identity_and_public_origin_are_enforced(client, db):
    account, customer, _, _, _, body = configure(client)
    personal = client.post(BASE + "/booking-invites", json={"customer_id": customer["id"]}).json()[
        "share_path"
    ]
    from urllib.parse import parse_qs

    identity = parse_qs(personal.split("#")[1])["identity"][0]
    result = request(client, {**body, "identity_token": identity})
    assert result.status_code == 201, result.text
    row = db.query(TableReservation).one()
    assert str(row.customer_id) == customer["id"]
    activity = client.get(f"/api/v1/customers/{customer['id']}/activity").json()
    assert activity["sections"][0]["items"][0]["table_id"] == str(row.id)
    assert (
        client.post(
            PUBLIC + "/table-requests",
            json=body,
            headers={"Origin": "https://evil.example", "Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )
    assert request(client, {**body, "party_size": 51}).status_code == 422
    other, _ = setup(client)
    assert other["tenant_id"] != account["tenant_id"]
    assert client.get(BASE + f"/table-reservations/{row.id}").status_code == 404
    assert client.get(BASE + "/table-reservations").json()["items"] == []


@pytest.fixture
def committed_tables(owner_engine):
    from app.billing.models import Subscription
    from app.tests.test_appointments import committed_appointment_resource

    seed = committed_appointment_resource.__wrapped__(owner_engine)
    tenant, customer, _ = next(seed)
    try:
        with Session(owner_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            db.add(
                Subscription(
                    tenant_id=tenant,
                    status="active",
                    current_period_end=datetime.now(UTC) + timedelta(days=30),
                )
            )
            db.commit()
            _, r = agenda.create_resource(
                db,
                tenant,
                tenant,
                AppointmentResourceCreate(
                    name="Mesa concurrente", timezone="America/Mexico_City", kind="table"
                ),
                str(uuid4()),
            )
            r_id = UUID(r["id"])
            service.save_availability(
                db,
                tenant,
                tenant,
                r_id,
                AvailabilityWrite(
                    expected_version=0,
                    exceptions=[],
                    weekly=[
                        {"weekday": i, "windows": [{"start": "09:00", "end": "20:00"}]}
                        for i in range(7)
                    ],
                ),
                str(uuid4()),
            )
            page_data = service.save_page(
                db,
                tenant,
                tenant,
                PageWrite(expected_version=0, enabled=True, mode="tables"),
                str(uuid4()),
            )
            token = page_data["share_path"].split("/")[-1]
            page = service.resolve_page(db, token)
            day = datetime.now(ZoneInfo(r["timezone"])).date() + timedelta(days=2)
            start = tables.arrivals(db, page, day)[0]["starts_at"]
        yield (
            tenant,
            r_id,
            TableRequestWrite(
                page_token=token,
                starts_at=start,
                name="Invitado concurrente",
                phone="5512345678",
                party_size=2,
            ),
        )
    finally:
        with owner_engine.begin() as conn:
            for name in (
                "table_reservation_history",
                "table_reservations",
                "booking_availability",
                "booking_pages",
                "subscriptions",
            ):
                conn.execute(
                    text(f"DELETE FROM {name} WHERE tenant_id=:tenant"), {"tenant": tenant}
                )
        next(seed, None)


def test_runtime_concurrent_confirmations_have_one_winner_and_requests_replay(
    kova_app_engine, committed_tables
):
    tenant, resource, body = committed_tables
    key = str(uuid4())

    def send(_):
        with Session(kova_app_engine) as db:
            return tables.create(db, body, key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(send, range(2)))
    assert receipts[0] == receipts[1]
    with Session(kova_app_engine) as db:
        assert not db.execute(text("SELECT * FROM table_reservations")).all()
        set_tenant_context(db, uuid4())
        assert not db.execute(text("SELECT * FROM table_reservations")).all()
        tables.create(db, body, str(uuid4()))
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        rows = db.query(TableReservation).all()
        assert len(rows) == 2
        ids = [r.id for r in rows]
    barrier = Barrier(2)

    def confirm(row_id):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            barrier.wait(timeout=10)
            try:
                tables.act(
                    db,
                    tenant,
                    tenant,
                    row_id,
                    TableAction(expected_version=1, action="confirm", resource_id=resource),
                    str(uuid4()),
                )
                return 200
            except HTTPException as e:
                db.rollback()
                return e.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(confirm, ids)) == [200, 409]


def test_staff_permissions_and_csrf_apply_to_table_actions(client, db):
    from app.auth.models import Membership

    account, _, resource, _, _, body = configure(client)
    assert request(client, body).status_code == 201
    row = listing(client)[0]
    assert (
        client.post(
            BASE + f"/table-reservations/{row['id']}/action",
            json={
                "expected_version": row["version"],
                "action": "confirm",
                "resource_id": resource["id"],
            },
            headers={"Idempotency-Key": str(uuid4()), "X-CSRF-Token": ""},
        ).status_code
        == 403
    )
    member = db.query(Membership).filter_by(tenant_id=UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE + "/table-reservations").status_code == 403
    assert action(client, row, "confirm", resource=resource).status_code == 403
    member.role = "manager"
    db.commit()
    assert action(client, row, "confirm", resource=resource).status_code == 200


def test_runtime_concurrent_arrivals_cannot_occupy_one_table_twice(
    kova_app_engine, committed_tables, monkeypatch
):
    tenant, resource, body = committed_tables
    with Session(kova_app_engine) as db:
        tables.create(db, body, str(uuid4()))
        later = body.model_copy(update={"starts_at": body.starts_at + timedelta(minutes=15)})
        tables.create(db, later, str(uuid4()))
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        ids = [r.id for r in db.query(TableReservation).all()]
        for row_id in ids:
            tables.act(
                db,
                tenant,
                tenant,
                row_id,
                TableAction(expected_version=1, action="confirm", resource_id=resource),
                str(uuid4()),
            )
    stamp = later.starts_at + timedelta(minutes=1)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return stamp.astimezone(tz or UTC)

    monkeypatch.setattr(tables, "datetime", Clock)
    barrier = Barrier(2)

    def seat(row_id):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            barrier.wait(timeout=10)
            try:
                tables.act(
                    db,
                    tenant,
                    tenant,
                    row_id,
                    TableAction(expected_version=2, action="seat"),
                    str(uuid4()),
                )
                return 200
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(seat, ids)) == [200, 409]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert db.query(TableReservation).filter_by(status="seated").count() == 1

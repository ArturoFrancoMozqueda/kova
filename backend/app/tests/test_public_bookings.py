from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.appointments.models import Appointment
from app.bookings import service
from app.bookings.models import BookingHistory, PublicBooking
from app.bookings.schemas import BookingWrite
from app.config import settings
from app.customers.models import Customer
from app.db import set_tenant_context
from app.tests import test_appointments as appointment_tests
from app.tests.test_appointments import (  # noqa: F401
    BASE,
    booking_body,
    resource,
)
from app.tests.test_crm import setup


@pytest.fixture
def committed_booking_resource(owner_engine):
    yield from appointment_tests.committed_appointment_resource.__wrapped__(owner_engine)


pytestmark = pytest.mark.usefixtures("fast_business_auth")
PUBLIC = "/api/v1/public/bookings"


def write(client, path, body, method="put", key=None):
    response = getattr(client, method)(
        BASE + path, json=body, headers={"Idempotency-Key": key or str(uuid4())}
    )
    assert response.status_code == 200, response.text
    return response.json()


def configure(client, account_customer=None):
    account, customer = account_customer if account_customer else setup(client)
    r = resource(client)
    svc = write(
        client,
        "/services",
        {
            "name": "Consulta",
            "description": "Atención individual",
            "duration_minutes": 30,
            "resource_ids": [r["id"]],
        },
        "post",
    )
    tomorrow = (datetime.now(ZoneInfo(r["timezone"])) + timedelta(days=2)).date()
    write(
        client,
        f"/availability/{r['id']}",
        {
            "expected_version": 0,
            "weekly": [
                {"weekday": i, "windows": [{"start": "09:00", "end": "18:00"}]} for i in range(7)
            ],
            "exceptions": [],
        },
    )
    assert client.get(BASE + "/booking-page").json()["enabled"] is False
    page = write(client, "/booking-page", {"expected_version": 0, "enabled": True})
    token = page["share_path"].split("/")[-1]
    offered = client.get(
        PUBLIC + "/slots",
        params={
            "page_token": token,
            "service_id": svc["id"],
            "resource_id": r["id"],
            "day": str(tomorrow),
        },
    ).json()["items"]
    assert offered
    body = {
        "page_token": token,
        "service_id": svc["id"],
        "resource_id": r["id"],
        "starts_at": offered[0]["starts_at"],
        "name": "Invitado",
        "phone": customer["phone"],
    }
    return account, customer, r, svc, page, body


def reserve(client, body, key=None):
    return client.post(
        PUBLIC,
        json=body,
        headers={"Idempotency-Key": key or str(uuid4()), "Origin": settings.frontend_url},
    )


def manage_read(client, token):
    return client.post(
        PUBLIC + "/manage/read", json={"token": token}, headers={"Origin": settings.frontend_url}
    )


def test_guest_confirmation_replay_conflicts_internal_agenda_and_explicit_link(client, db):
    _, customer, r, _, _, body = configure(client)
    initial_customers = db.query(Customer).count()
    key = str(uuid4())
    created = reserve(client, body, key)
    assert created.status_code == 201, created.text
    result = created.json()
    assert result["status"] == "scheduled"
    assert reserve(client, body, key).json() == result
    assert reserve(client, body).status_code == 409
    row = db.query(PublicBooking).one()
    assert row.customer_id is None  # Identical contact is never an identity credential.
    assert db.query(Customer).count() == initial_customers
    native_body = booking_body(
        customer, r, start=datetime.fromisoformat(body["starts_at"]), duration=30
    )
    assert (
        client.post(BASE, json=native_body, headers={"Idempotency-Key": str(uuid4())}).status_code
        == 409
    )
    read = manage_read(client, result["manage_path"].split("#")[1])
    assert read.status_code == 200
    assert "phone" not in read.json() and "customer_id" not in read.json()
    linked = write(
        client,
        f"/bookings/{row.id}/customer",
        {"expected_version": 1, "customer_id": customer["id"]},
        "post",
        "link-once",
    )
    replay = write(
        client,
        f"/bookings/{row.id}/customer",
        {"expected_version": 1, "customer_id": customer["id"]},
        "post",
        "link-once",
    )
    assert replay == linked
    db.refresh(row)
    assert str(row.appointment_id) == linked["appointment_id"]
    assert db.query(Appointment).count() == 1
    end = datetime.fromisoformat(result["ends_at"])
    native_body = booking_body(customer, r, start=end, duration=30)
    assert (
        client.post(BASE, json=native_body, headers={"Idempotency-Key": str(uuid4())}).status_code
        == 201
    )
    assert db.query(BookingHistory).filter_by(booking_id=row.id).count() == 2


def test_personal_identity_management_revoke_and_cutoff(client, db):
    _, customer, _, _, page, body = configure(client)
    invite = client.post(BASE + "/booking-invites", json={"customer_id": customer["id"]}).json()[
        "share_path"
    ]
    body["identity_token"] = invite.split("#identity=")[1]
    result = reserve(client, body)
    assert result.status_code == 201, result.text
    row = db.query(PublicBooking).one()
    assert str(row.customer_id) == customer["id"]
    token = result.json()["manage_path"].split("#")[1]
    assert manage_read(client, body["identity_token"]).status_code == 404
    write(client, f"/bookings/{row.id}/revoke", {"expected_version": 1}, "post")
    assert manage_read(client, token).status_code == 404
    assert client.get(BASE + "/booking-page").json() == page


def test_public_reschedule_and_cancel_are_idempotent_and_free_slots(client, db):
    _, _, r, svc, _, body = configure(client)
    result = reserve(client, body).json()
    token = result["manage_path"].split("#")[1]
    day = datetime.fromisoformat(body["starts_at"]).astimezone(
        ZoneInfo(r["timezone"])
    ).date() + timedelta(days=1)
    available = client.post(
        PUBLIC + "/manage/slots", params={"day": str(day)}, json={"token": token}
    ).json()["items"]
    change = {
        "token": token,
        "expected_version": 1,
        "action": "reschedule",
        "starts_at": available[0]["starts_at"],
    }
    key = str(uuid4())
    changed = client.post(PUBLIC + "/manage", json=change, headers={"Idempotency-Key": key})
    assert changed.status_code == 200, changed.text
    assert (
        client.post(PUBLIC + "/manage", json=change, headers={"Idempotency-Key": key}).json()
        == changed.json()
    )
    cancelled = client.post(
        PUBLIC + "/manage",
        json={"token": token, "expected_version": 2, "action": "cancel"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    offered = client.get(
        PUBLIC + "/slots",
        params={
            "page_token": body["page_token"],
            "service_id": svc["id"],
            "resource_id": r["id"],
            "day": str(day),
        },
    ).json()["items"]
    assert available[0] in offered
    assert db.query(BookingHistory).count() == 3


def test_exceptions_origin_tampering_and_page_pause(client, db):
    _, _, r, svc, page, body = configure(client)
    day = datetime.fromisoformat(body["starts_at"]).astimezone(ZoneInfo(r["timezone"])).date()
    write(
        client,
        f"/availability/{r['id']}",
        {"expected_version": 1, "weekly": [], "exceptions": [{"date": str(day), "windows": []}]},
    )
    assert reserve(client, body).status_code == 409
    assert (
        client.post(
            PUBLIC,
            json=body,
            headers={"Origin": "https://evil.example", "Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )
    assert (
        client.get(PUBLIC + "/context", params={"page_token": body["page_token"] + "x"}).status_code
        == 404
    )
    write(client, "/booking-page", {"expected_version": page["version"], "enabled": False})
    assert (
        client.get(PUBLIC + "/context", params={"page_token": body["page_token"]}).status_code
        == 404
    )
    assert db.query(PublicBooking).count() == 0


def test_runtime_rls_and_two_public_reservations_have_one_winner(
    owner_engine, kova_app_engine, committed_booking_resource
):
    from app.billing.models import Subscription
    from app.bookings.schemas import AvailabilityWrite, PageWrite, ServiceWrite
    from app.branches.scope import bind_branch

    tenant, customer_id, resource_row = committed_booking_resource
    try:
        with Session(owner_engine) as session:
            set_tenant_context(session, tenant)
            bind_branch(session, tenant_id=tenant)
            session.add(
                Subscription(
                    tenant_id=tenant,
                    status="active",
                    current_period_end=datetime.now(UTC) + timedelta(days=30),
                )
            )
            session.commit()
            service.save_service(
                session,
                tenant,
                tenant,
                ServiceWrite(
                    name="Consulta", duration_minutes=30, resource_ids=[resource_row["id"]]
                ),
                str(uuid4()),
            )
            selected = service.services(session, tenant)[0]
            service.save_availability(
                session,
                tenant,
                tenant,
                UUID(resource_row["id"]),
                AvailabilityWrite(
                    expected_version=0,
                    weekly=[
                        {"weekday": i, "windows": [{"start": "09:00", "end": "18:00"}]}
                        for i in range(7)
                    ],
                    exceptions=[],
                ),
                str(uuid4()),
            )
            page_data = service.save_page(
                session, tenant, tenant, PageWrite(expected_version=0, enabled=True), str(uuid4())
            )
            token = page_data["share_path"].split("/")[-1]
            page = service.resolve_page(session, token)
            day = datetime.now(ZoneInfo("America/Mexico_City")).date() + timedelta(days=2)
            offered = service.slots(
                session, page, UUID(selected["id"]), UUID(resource_row["id"]), day
            )
            payload = BookingWrite(
                page_token=token,
                service_id=selected["id"],
                resource_id=resource_row["id"],
                starts_at=offered[0]["starts_at"],
                name="Invitado",
                phone="5512345678",
            )

        def attempt(_):
            with Session(kova_app_engine) as session:
                try:
                    service.create(session, payload, str(uuid4()))
                    return 201
                except Exception as exc:
                    session.rollback()
                    if getattr(exc, "status_code", None) == 409:
                        return 409
                    raise

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(attempt, range(2))) == [201, 409]
        with Session(kova_app_engine) as session:
            assert not session.execute(text("select * from public_bookings")).all()
            set_tenant_context(session, uuid4())
            assert not session.execute(text("select * from public_bookings")).all()
            set_tenant_context(session, tenant)
            assert len(session.execute(text("select * from public_bookings")).all()) == 1
        # The internal writer participates in exactly the same exclusion protocol.
        with owner_engine.begin() as connection:
            for table in ("booking_history", "public_bookings"):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
                )
        from threading import Barrier

        from app.appointments import service as internal
        from app.appointments.schemas import AppointmentCreate

        barrier = Barrier(2)

        def mixed_attempt(index):
            with Session(kova_app_engine) as session:
                set_tenant_context(session, tenant)
                bind_branch(session, tenant_id=tenant)
                barrier.wait(timeout=10)
                try:
                    if index == 0:
                        service.create(session, payload, str(uuid4()))
                    else:
                        internal.create_appointment(
                            session,
                            tenant,
                            tenant,
                            AppointmentCreate(
                                resource_id=resource_row["id"],
                                customer_id=customer_id,
                                title="Cita del equipo",
                                starts_at=payload.starts_at,
                                ends_at=payload.starts_at + timedelta(minutes=30),
                            ),
                            str(uuid4()),
                        )
                    return 201
                except Exception as exc:
                    session.rollback()
                    if getattr(exc, "status_code", None) == 409:
                        return 409
                    raise

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(mixed_attempt, range(2))) == [201, 409]
    finally:
        with owner_engine.begin() as connection:
            for table in (
                "booking_history",
                "public_bookings",
                "booking_service_resources",
                "booking_availability",
                "booking_services",
                "booking_pages",
                "subscriptions",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
                )


def test_dst_nonexistent_and_ambiguous_hours_are_explicit():
    from datetime import date

    zone = ZoneInfo("America/Tijuana")
    assert service._instants(date(2026, 3, 8), "02:30", zone) == []
    instants = service._instants(date(2026, 11, 1), "01:30", zone)
    assert len(instants) == 2 and instants[1] - instants[0] == timedelta(hours=1)


def test_membership_exchange_links_only_its_exact_program_and_customer(client, db):
    from app.loyalty.models import LoyaltyMember
    from app.tests.test_loyalty_enrollment import bootstrap, join, prepare

    tenant, old_customer, menu = prepare(client)
    old_profile = client.get(f"/api/v1/customers/{old_customer}").json()
    _, _, _, _, _, own_body = configure(client, ({"tenant_id": str(tenant)}, old_profile))
    _, _, _, _, _, foreign_body = configure(client)
    client.cookies.clear()
    context = bootstrap(client, menu).json()
    joined = join(client, menu, context)
    assert joined.status_code == 201, joined.text
    before = db.query(Customer).count()
    granted = client.post(
        "/api/v1/public/loyalty/membership/booking-grant",
        json={"menu_token": menu, "page_token": own_body["page_token"]},
    )
    assert granted.status_code == 200, granted.text
    own_body["identity_token"] = granted.json()["identity_token"]
    assert reserve(client, own_body).status_code == 201
    assert db.query(PublicBooking).one().customer_id == db.query(LoyaltyMember).one().customer_id
    cross = client.post(
        "/api/v1/public/loyalty/membership/booking-grant",
        json={"menu_token": menu, "page_token": foreign_body["page_token"]},
    )
    assert cross.status_code == 404
    assert db.query(Customer).count() == before


def test_personal_identity_cannot_survive_customer_revision_or_be_used_as_management(client, db):
    _, customer, _, _, _, body = configure(client)
    invite = client.post(BASE + "/booking-invites", json={"customer_id": customer["id"]}).json()[
        "share_path"
    ]
    body["identity_token"] = invite.split("#identity=")[1]
    updated = client.put(
        f"/api/v1/customers/{customer['id']}",
        json={
            "name": "Nombre actualizado",
            "phone": customer["phone"],
            "email": customer["email"],
            "is_active": True,
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert updated.status_code == 200, updated.text
    assert reserve(client, body).status_code == 404
    assert db.query(PublicBooking).count() == 0


def test_manage_revalidates_cutoff_after_linking_to_internal_appointment(client, db):
    _, customer, _, _, _, body = configure(client)
    result = reserve(client, body).json()
    token = result["manage_path"].split("#")[1]
    row = db.query(PublicBooking).one()
    linked = write(
        client,
        f"/bookings/{row.id}/customer",
        {"customer_id": customer["id"], "expected_version": 1},
        "post",
    )
    current = manage_read(client, token).json()
    assert (
        current["version"] == 3
    )  # Includes public association and the internal appointment version.
    stale = client.post(
        PUBLIC + "/manage",
        json={"token": token, "expected_version": 1, "action": "cancel"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert stale.status_code == 409
    appointment = db.query(Appointment).filter_by(id=UUID(linked["appointment_id"])).one()
    appointment.starts_at = datetime.now(UTC) + timedelta(hours=1)
    appointment.ends_at = appointment.starts_at + timedelta(minutes=30)
    db.commit()
    assert manage_read(client, token).json()["can_manage"] is False
    denied = client.post(
        PUBLIC + "/manage",
        json={"token": token, "expected_version": 3, "action": "cancel"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert denied.status_code == 409


def test_team_can_reschedule_a_confirmed_guest_without_creating_or_matching_customers(client, db):
    _, _, _, _, _, body = configure(client)
    created = reserve(client, body).json()
    row = db.query(PublicBooking).one()
    count = db.query(Customer).count()
    start = datetime.fromisoformat(body["starts_at"]) + timedelta(days=1)
    changed = write(
        client,
        f"/bookings/{row.id}/reschedule",
        {"expected_version": 1, "starts_at": start.isoformat()},
        "post",
        "staff-move",
    )
    assert changed["customer_id"] is None
    assert datetime.fromisoformat(changed["starts_at"]) == start
    assert db.query(Customer).count() == count
    assert db.query(Appointment).count() == 0
    assert db.query(BookingHistory).count() == 2
    token = created["manage_path"].split("#")[1]
    assert datetime.fromisoformat(manage_read(client, token).json()["starts_at"]) == start


def test_owner_preview_matches_public_page_and_applies_unsaved_settings(client):
    _account, _customer, r, svc, page, body = configure(client)
    token = body["page_token"]
    tomorrow = (datetime.now(ZoneInfo(r["timezone"])) + timedelta(days=2)).date()
    public_context = client.get(PUBLIC + "/context", params={"page_token": token}).json()
    public_slots = client.get(PUBLIC + "/slots", params={
        "page_token": token, "service_id": svc["id"], "resource_id": r["id"], "day": str(tomorrow),
    }).json()["items"]

    same = client.post(BASE + "/booking-preview", json={
        "service_id": svc["id"], "resource_id": r["id"], "day": str(tomorrow),
    })
    assert same.status_code == 200, same.text
    assert same.headers["Cache-Control"] == "private, no-store"
    assert same.json()["context"] == public_context
    assert same.json()["slots"] == public_slots

    # Unsaved hours and spacing change the offer without touching saved settings.
    draft = client.post(BASE + "/booking-preview", json={
        "page": {"horizon_days": 7, "notice_minutes": 0, "slot_minutes": 60, "manage_cutoff_hours": 2},
        "availability": {
            "resource_id": r["id"],
            "weekly": [{"weekday": tomorrow.weekday(), "windows": [{"start": "10:00", "end": "12:00"}]}],
            "exceptions": [],
        },
        "day": str(tomorrow),
    }).json()
    assert draft["context"]["horizon_days"] == 7
    assert draft["context"]["manage_cutoff_hours"] == 2
    assert draft["selection"] == {"service_id": svc["id"], "resource_id": r["id"], "day": str(tomorrow)}
    starts = [datetime.fromisoformat(s["starts_at"]).astimezone(ZoneInfo(r["timezone"])).strftime("%H:%M") for s in draft["slots"]]
    assert starts == ["10:00", "11:00"]
    saved = client.get(BASE + "/booking-page").json()
    assert (saved["slot_minutes"], saved["horizon_days"], saved["version"]) == (15, 30, page["version"])
    assert client.get(BASE + f"/availability/{r['id']}").json()["version"] == 1

    # Without a day, the preview picks the first day that customers could book.
    suggested = client.post(BASE + "/booking-preview", json={}).json()
    assert suggested["selection"]["service_id"] == svc["id"]
    assert suggested["slots"]


def test_owner_preview_is_private_validated_and_read_only(client, db):
    configure(client)
    invalid = client.post(BASE + "/booking-preview", json={"availability": {
        "resource_id": str(uuid4()), "weekly": [{"weekday": 1, "windows": [{"start": "12:00", "end": "10:00"}]}], "exceptions": [],
    }})
    assert invalid.status_code == 422
    assert client.post(BASE + "/booking-preview", json={"page": {"slot_minutes": 1}}).status_code == 422
    before = db.query(PublicBooking).count()
    assert client.post(BASE + "/booking-preview", json={}).status_code == 200
    assert db.query(PublicBooking).count() == before
    client.cookies.clear()
    assert client.post(BASE + "/booking-preview", json={}).status_code in {401, 403}

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from app.appointments.models import Appointment
from app.auth.models import Membership
from app.bookings.models import PublicBooking
from app.customers.models import Customer
from app.messaging import reservations
from app.messaging.models import Message, ReservationNotice
from app.tests import test_public_bookings as public
from app.tests import test_table_reservations as tables
from app.tests.test_appointments import book, booking_body, post, resource
from app.tests.test_crm import consent, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
URL = "/api/v1/messaging/reservation-notices"


def notices(client):
    response = client.get(URL)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["send_enabled"] is False
    assert data["template_status"] == "not_checked"
    return data["items"]


def test_confirmation_and_24h_reminder_are_durable_replay_safe_and_never_sent(client, db):
    _, customer = setup(client)
    selected = resource(client, timezone="America/Tijuana")
    start = (datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0)
    body = booking_body(customer, selected, start=start)
    created = post(client, "", body, "notice-once")
    assert created.status_code == 201, created.text
    assert post(client, "", body, "notice-once").json() == created.json()
    items = notices(client)
    assert len(items) == 2 and db.query(ReservationNotice).count() == 2
    reminder = next(n for n in items if n["kind"] == "reminder")
    assert datetime.fromisoformat(reminder["due_at"]) == start - timedelta(hours=24)
    assert reminder["status"] == "scheduled"
    local = start.astimezone(ZoneInfo("America/Tijuana"))
    assert local.strftime("%d/%m/%Y") in reminder["body"]
    assert local.strftime("%H:%M") in reminder["body"]
    assert all(n["contact_status"] == "consent_required" for n in items)
    assert db.query(Message).count() == 0
    assert client.post(URL, json={"send_enabled": True}).status_code == 405
    assert client.post(
        f"/api/v1/messaging/messages/{items[0]['id']}/send",
        json={"expected_version": 1},
        headers={"Idempotency-Key": "cannot-send-notice"},
    ).status_code in {404, 409}
    assert db.query(Message).count() == 0


def test_reschedule_replaces_old_notices_and_cancel_suppresses_both(client, db):
    _, customer = setup(client)
    r = resource(client)
    start = (datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0)
    row = book(client, customer, r, start=start)
    original = {n["id"] for n in notices(client)}
    changed = post(
        client,
        f"/{row['id']}/reschedule",
        {
            "expected_version": 1,
            "starts_at": (start + timedelta(days=1)).isoformat(),
            "ends_at": (start + timedelta(days=1, hours=1)).isoformat(),
        },
        "reschedule-notice",
    )
    assert changed.status_code == 200, changed.text
    items = notices(client)
    assert len(items) == 2 and not original.intersection(n["id"] for n in items)
    assert db.query(ReservationNotice).filter_by(state="suppressed").count() == 2
    assert (
        post(
            client, f"/{row['id']}/transition", {"expected_version": 2, "status": "cancelled"}
        ).status_code
        == 200
    )
    assert notices(client) == []
    assert db.query(ReservationNotice).filter_by(state="suppressed").count() == 4


def test_booking_with_less_than_24h_only_prepares_confirmation_and_expired_notices_hide(
    client, monkeypatch
):
    _, customer = setup(client)
    start = (datetime.now(UTC) + timedelta(hours=2)).replace(microsecond=0)
    book(client, customer, resource(client), start=start)
    assert [n["kind"] for n in notices(client)] == ["confirmation"]
    monkeypatch.setattr(reservations, "now", lambda: start + timedelta(minutes=1))
    assert notices(client) == []


def test_guest_booking_is_not_inferred_from_phone_and_materialization_does_not_duplicate(
    client, db
):
    _, customer, r, _, _, body = public.configure(client)
    public_key = str(uuid4())
    receipt = public.reserve(client, body, public_key)
    assert receipt.status_code == 201, receipt.text
    assert public.reserve(client, body, public_key).json() == receipt.json()
    items = notices(client)
    assert len(items) == 2 and all(n["contact_status"] == "customer_required" for n in items)
    original = {n["id"] for n in items}
    booking = db.query(PublicBooking).one()
    linked = public.write(
        client,
        f"/bookings/{booking.id}/customer",
        {"expected_version": 1, "customer_id": customer["id"]},
        "post",
    )
    assert {n["id"] for n in notices(client)} == original
    assert all(n["source"] == "booking" for n in notices(client))
    start = datetime.fromisoformat(body["starts_at"]) + timedelta(days=1)
    assert (
        post(
            client,
            f"/{linked['appointment_id']}/reschedule",
            {
                "expected_version": 1,
                "starts_at": start.isoformat(),
                "ends_at": (start + timedelta(minutes=30)).isoformat(),
            },
        ).status_code
        == 200
    )
    assert len(notices(client)) == 2
    assert all(n["source"] == "booking" for n in notices(client))
    assert (
        post(
            client,
            f"/{linked['appointment_id']}/transition",
            {"expected_version": 2, "status": "cancelled"},
        ).status_code
        == 200
    )
    assert notices(client) == []


def test_public_reschedule_and_cancellation_invalidate_previews(client, db):
    _, _, _, _, _, body = public.configure(client)
    result = public.reserve(client, body).json()
    token = result["manage_path"].split("#")[1]
    original = {n["id"] for n in notices(client)}
    start = datetime.fromisoformat(body["starts_at"]) + timedelta(minutes=30)
    response = client.post(
        public.PUBLIC + "/manage",
        json={
            "token": token,
            "expected_version": result["version"],
            "action": "reschedule",
            "starts_at": start.isoformat(),
        },
        headers={"Idempotency-Key": "public-reschedule"},
    )
    assert response.status_code == 200, response.text
    assert len(notices(client)) == 2
    assert not original.intersection(n["id"] for n in notices(client))
    response = client.post(
        public.PUBLIC + "/manage",
        json={"token": token, "expected_version": response.json()["version"], "action": "cancel"},
        headers={"Idempotency-Key": "public-cancel"},
    )
    assert response.status_code == 200, response.text
    assert notices(client) == []


def test_table_request_waits_for_confirmation_and_cancellation_removes_previews(client, db):
    _, _, r, _, _, body = tables.configure(client)
    result = tables.request(client, body).json()
    assert notices(client) == []
    row = tables.listing(client)[0]
    response = tables.action(client, row, "confirm", resource=r)
    assert response.status_code == 200, response.text
    items = notices(client)
    assert len(items) == 2
    assert all(n["source"] == "reservation" and "3 personas" in n["body"] for n in items)
    assert tables.action(client, response.json(), "cancel").status_code == 200
    assert notices(client) == []
    assert result["status"] == "requested"


def test_contact_permission_is_revalidated_and_phone_change_never_authorizes_delivery(client, db):
    _, customer = setup(client)
    book(client, customer, resource(client))
    assert notices(client)[0]["contact_status"] == "consent_required"
    assert consent(client, customer).status_code == 200
    assert notices(client)[0]["contact_status"] == "international_phone_required"
    assert consent(client, customer, enabled=False, expected_version=1).status_code == 200
    assert notices(client)[0]["contact_status"] == "consent_required"
    db.query(Customer).filter_by(id=UUID(customer["id"])).one().phone = "5598765432"
    db.flush()
    assert notices(client)[0]["contact_status"] == "contact_changed"
    assert db.query(Message).count() == 0


def test_failed_booking_transaction_rolls_back_notices(client, db, monkeypatch):
    _, customer = setup(client)
    r = resource(client)
    body = booking_body(customer, r)
    from app.appointments import service
    from app.appointments.schemas import AppointmentCreate

    def fail_before_commit(*args, **kwargs):
        raise RuntimeError("rollback before outer commit")

    monkeypatch.setattr(service, "_finish", fail_before_commit)
    tenant = db.get(Customer, UUID(customer["id"])).tenant_id
    with pytest.raises(RuntimeError), db.begin_nested():
        service.create_appointment(
            db,
            tenant,
            db.query(Membership).filter_by(role="owner").one().user_id,
            AppointmentCreate(**body),
            "notice-rollback",
        )
    assert db.query(Appointment).count() == 0
    assert db.query(ReservationNotice).count() == 0


def test_notices_are_private_and_tenant_scoped(client, db):
    _, customer = setup(client)
    book(client, customer, resource(client))
    assert notices(client)
    _, second = setup(client)  # Another authenticated business, never a request tenant.
    assert notices(client) == []
    assert (
        client.get(URL + "?tenant_id=" + str(db.query(ReservationNotice).first().tenant_id)).json()[
            "items"
        ]
        == []
    )
    member = (
        db.query(Membership)
        .filter_by(tenant_id=db.get(Customer, UUID(second["id"])).tenant_id)
        .one()
    )
    member.role = "cashier"
    db.flush()
    assert client.get(URL).status_code == 403


def test_notices_follow_selected_branch_and_pagination(client):
    _, customer = setup(client)
    r = resource(client)
    book(client, customer, r, start=datetime.now(UTC) + timedelta(days=3))
    created = client.post(
        "/api/v1/branches",
        json={"name": "Centro", "address": "Calle 1"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201, created.text
    branch = created.json()["id"]
    assert client.get(URL, headers={"X-Kova-Branch": branch}).json()["items"] == []
    first = client.get(URL + "?limit=1").json()
    second = client.get(URL + "?limit=1&offset=1").json()
    assert first["has_more"] is True and second["has_more"] is False
    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]

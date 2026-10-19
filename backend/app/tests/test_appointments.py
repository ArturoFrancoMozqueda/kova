from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.appointments import service
from app.appointments.models import (
    Appointment,
    AppointmentHistory,
    AppointmentReminder,
)
from app.appointments.schemas import AppointmentCreate
from app.audit.models import AuditLog
from app.auth.models import Membership
from app.customers.models import Customer
from app.tests.test_crm import setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/appointments"


def post(client, path, body, key=None, branch=None):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.post(BASE + path, json=body, headers=headers)


def resource(client, *, branch=None, name="Cabina real", timezone="America/Mexico_City"):
    response = post(client, "/resources", {"name": name, "timezone": timezone}, branch=branch)
    assert response.status_code == 201, response.text
    return response.json()


def booking_body(customer, resource, *, start=None, duration=60):
    start = start or (datetime.now(UTC) + timedelta(hours=4)).replace(microsecond=0)
    return {
        "resource_id": resource["id"],
        "customer_id": customer["id"],
        "title": "Atención de cliente",
        "note": "Revisar necesidad acordada",
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(minutes=duration)).isoformat(),
    }


def book(client, customer, resource, **kwargs):
    response = post(client, "", booking_body(customer, resource, **kwargs))
    assert response.status_code == 201, response.text
    return response.json()


def test_real_resource_booking_utc_overlap_contiguous_and_replay(client, db):
    _account, customer = setup(client)
    assert client.get(BASE + "/resources").json() == {"items": []}
    selected = resource(client)
    start = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0)
    body = booking_body(customer, selected, start=start)
    created = post(client, "", body, "book-once")
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["status"] == "scheduled" and row["version"] == 1
    assert row["timezone"] == "America/Mexico_City" and row["starts_at"].endswith("Z")
    assert post(client, "", body, "book-once").json() == row
    assert (
        post(
            client, "", booking_body(customer, selected, start=start + timedelta(minutes=30))
        ).status_code
        == 409
    )
    assert (
        post(
            client, "", booking_body(customer, selected, start=start + timedelta(hours=1))
        ).status_code
        == 201
    )
    other = resource(client, name="Otra cabina real")
    assert post(client, "", booking_body(customer, other, start=start)).status_code == 201
    assert db.query(AppointmentHistory).filter_by(appointment_id=UUID(row["id"])).count() == 1
    assert db.query(AppointmentReminder).filter_by(appointment_id=UUID(row["id"])).count() == 1
    audits = db.query(AuditLog).filter(AuditLog.action.like("appointment.%")).all()
    assert "Atención" not in str([item.changes for item in audits])
    assert "necesidad" not in str([item.changes for item in audits])


def test_reschedule_cancel_versions_history_and_suppress_old_reminders(client, db):
    _account, customer = setup(client)
    selected = resource(client)
    row = book(client, customer, selected)
    initial_reminder = db.query(AppointmentReminder).filter_by(appointment_id=UUID(row["id"])).one()
    assert initial_reminder.status == "pending"
    start = datetime.now(UTC) + timedelta(days=2)
    body = {
        "expected_version": 1,
        "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=1)).isoformat(),
        "note": "Nueva fecha acordada",
    }
    response = post(client, f"/{row['id']}/reschedule", body, "reschedule-once")
    assert response.status_code == 200, response.text
    changed = response.json()
    assert changed["version"] == 2 and changed["note"] == "Nueva fecha acordada"
    assert post(client, f"/{row['id']}/reschedule", body, "reschedule-once").json() == changed
    assert post(client, f"/{row['id']}/reschedule", body).status_code == 409
    db.refresh(initial_reminder)
    assert initial_reminder.status == "suppressed"
    result = post(
        client, f"/{row['id']}/transition", {"expected_version": 2, "status": "cancelled"}
    )
    assert result.status_code == 200, result.text
    history = client.get(BASE + f"/{row['id']}/history").json()["items"]
    assert [item["action"] for item in history] == ["created", "rescheduled", "cancelled"]
    assert all(item["starts_at"].endswith("Z") for item in history)
    assert (
        db.query(AppointmentReminder)
        .filter_by(appointment_id=UUID(row["id"]), status="pending")
        .count()
        == 0
    )
    assert post(client, "", booking_body(customer, selected, start=start)).status_code == 201
    assert (
        post(client, f"/{row['id']}/reschedule", {**body, "expected_version": 3}).status_code == 409
    )


def test_due_internal_reminder_is_reviewable_without_any_external_account(client, db):
    _account, customer = setup(client)
    selected = resource(client)
    row = book(client, customer, selected)
    tasks = client.get(BASE + "/reminders").json()["items"]
    assert len(tasks) == 1 and tasks[0]["appointment_id"] == row["id"]
    reminder = tasks[0]
    result = post(
        client,
        f"/reminders/{reminder['id']}/resolve",
        {"expected_version": 1, "status": "completed"},
        "reminder-once",
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "completed"
    assert (
        post(
            client,
            f"/reminders/{reminder['id']}/resolve",
            {"expected_version": 1, "status": "completed"},
            "reminder-once",
        ).json()
        == result.json()
    )
    assert client.get(BASE + "/reminders").json()["items"] == []
    assert db.get(Appointment, UUID(row["id"])).status == "scheduled"


def test_inactive_customer_revokes_due_reminder_and_resource_blocks_new_bookings(client, db):
    _account, customer = setup(client)
    selected = resource(client)
    row = book(client, customer, selected)
    reminder = client.get(BASE + "/reminders").json()["items"][0]
    stored_customer = db.get(Customer, UUID(customer["id"]))
    stored_customer.is_active = False
    db.commit()
    assert (
        post(
            client,
            f"/reminders/{reminder['id']}/resolve",
            {"expected_version": 1, "status": "completed"},
        ).status_code
        == 409
    )
    assert (
        post(
            client,
            "",
            booking_body(customer, selected, start=datetime.now(UTC) + timedelta(days=2)),
        ).status_code
        == 409
    )
    stored_customer.is_active = True
    db.commit()
    response = client.patch(
        BASE + f"/resources/{selected['id']}",
        json={"expected_version": 1, "is_active": False},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    assert (
        post(
            client,
            "",
            booking_body(customer, selected, start=datetime.now(UTC) + timedelta(days=2)),
        ).status_code
        == 409
    )
    start = datetime.now(UTC) + timedelta(days=2)
    assert (
        post(
            client,
            f"/{row['id']}/reschedule",
            {
                "expected_version": 1,
                "starts_at": start.isoformat(),
                "ends_at": (start + timedelta(hours=1)).isoformat(),
            },
        ).status_code
        == 409
    )
    assert (
        post(
            client, f"/{row['id']}/transition", {"expected_version": 1, "status": "cancelled"}
        ).status_code
        == 200
    )


def test_scopes_roles_billing_and_headers(client, db, monkeypatch):
    account, customer = setup(client)
    selected = resource(client)
    row = book(client, customer, selected)
    branch = client.post(
        "/api/v1/branches", json={"name": "Agenda Norte"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()["id"]
    headers = {"X-Kova-Branch": branch}
    assert client.get(BASE, headers=headers).json()["items"] == []
    assert client.get(BASE + "/resources", headers=headers).json()["items"] == []
    assert client.get(BASE + f"/{row['id']}/history", headers=headers).status_code == 404
    assert post(client, "", booking_body(customer, selected), branch=branch).status_code == 404
    member = db.query(Membership).filter_by(tenant_id=UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE).status_code == 403
    member.role = "manager"
    db.commit()
    assert client.get(BASE).status_code == 200
    assert (
        client.post(
            BASE + "/resources", json={"name": "Sin clave", "timezone": "America/Cancun"}
        ).status_code
        == 400
    )
    from app.config import settings

    monkeypatch.setattr(settings, "billing_trial_days", -1)
    assert client.get(BASE).status_code == 402
    monkeypatch.setattr(settings, "billing_trial_days", 14)
    setup(client)
    assert client.get(BASE + f"/{row['id']}/history").status_code == 404
    assert post(client, "", booking_body(customer, selected)).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        {"starts_at": "2026-10-21T10:00:00"},
        {"starts_at": "2026-10-21T10:00:00Z", "ends_at": "2026-10-21T10:00:00Z"},
        {"starts_at": "2026-10-21T10:00:00Z", "ends_at": "2026-10-22T10:00:01Z"},
        {"tenant_id": str(uuid4())},
        {"title": "<script>bad</script>"},
        {"title": "   "},
    ],
)
def test_invalid_inputs_rejected(change):
    body = {
        "resource_id": uuid4(),
        "customer_id": uuid4(),
        "title": "Cita",
        "starts_at": "2026-10-21T10:00:00Z",
        "ends_at": "2026-10-21T11:00:00Z",
        **change,
    }
    with pytest.raises(ValidationError):
        AppointmentCreate(**body)


def test_interval_range_past_and_offset_and_resource_timezone(client):
    _account, customer = setup(client)
    selected = resource(client, timezone="America/Tijuana")
    start = (datetime.now(UTC) + timedelta(hours=5)).replace(microsecond=0)
    from datetime import timezone

    body = booking_body(customer, selected, start=start.astimezone(timezone(timedelta(hours=-7))))
    result = post(client, "", body)
    assert result.status_code == 201, result.text
    assert result.json()["starts_at"] == start.isoformat().replace("+00:00", "Z")
    assert result.json()["timezone"] == "America/Tijuana"
    for invalid in (
        datetime.now(UTC) - timedelta(minutes=1),
        datetime.now(UTC) + timedelta(days=367),
    ):
        assert post(client, "", booking_body(customer, selected, start=invalid)).status_code == 400
    assert client.get(BASE, params={"starts_from": "2026-10-20T00:00:00"}).status_code == 400
    assert (
        post(
            client, "/resources", {"name": "Zona desconocida", "timezone": "Europe/London"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            BASE + f"/resources/{selected['id']}",
            json={"expected_version": 1, "timezone": "America/Cancun"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 422
    )


def test_completion_no_show_only_after_start_and_final_state(client, db):
    _account, customer = setup(client)
    selected = resource(client)
    row = book(client, customer, selected)
    assert (
        post(
            client, f"/{row['id']}/transition", {"expected_version": 1, "status": "completed"}
        ).status_code
        == 409
    )
    stored = db.get(Appointment, UUID(row["id"]))
    stored.starts_at = datetime.now(UTC) - timedelta(minutes=30)
    stored.ends_at = datetime.now(UTC) + timedelta(minutes=30)
    db.commit()
    result = post(
        client, f"/{row['id']}/transition", {"expected_version": 1, "status": "completed"}
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "completed"
    assert (
        post(
            client, f"/{row['id']}/transition", {"expected_version": 2, "status": "cancelled"}
        ).status_code
        == 409
    )


@pytest.fixture
def committed_appointment_resource(owner_engine):
    from sqlalchemy.orm import Session

    from app.appointments.schemas import AppointmentResourceCreate
    from app.branches.scope import bind_branch
    from app.db import set_tenant_context
    from app.tenants.models import Tenant

    tenant, customer = uuid4(), uuid4()
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent agenda", slug=f"agenda-{tenant}"))
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant, "email": f"agenda-{tenant}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant},
        )
        db.add(Customer(id=customer, tenant_id=tenant, name="Concurrent customer"))
        db.flush()
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        _, resource_row = service.create_resource(
            db,
            tenant,
            tenant,
            AppointmentResourceCreate(name="Recurso concurrente", timezone="America/Mexico_City"),
            str(uuid4()),
        )
    try:
        yield tenant, customer, resource_row
    finally:
        with owner_engine.begin() as connection:
            for table in (
                "appointment_reminders",
                "appointment_history",
                "appointments",
                "appointment_resources",
                "customers",
                "audit_logs",
                "idempotency_keys",
                "memberships",
                "branches",
                "tenants",
                "users",
            ):
                column = "id" if table in {"tenants", "users"} else "tenant_id"
                connection.execute(
                    text(f"DELETE FROM {table} WHERE {column}=:tenant"), {"tenant": tenant}
                )


def test_concurrent_runtime_bookings_only_one_interval_wins(
    kova_app_engine, owner_engine, committed_appointment_resource
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.branches.scope import bind_branch
    from app.db import set_tenant_context

    tenant, customer, resource_row = committed_appointment_resource
    start = datetime.now(UTC) + timedelta(hours=8)
    body = AppointmentCreate(
        resource_id=resource_row["id"],
        customer_id=customer,
        title="Cita concurrente",
        starts_at=start,
        ends_at=start + timedelta(hours=1),
    )
    barrier = Barrier(2)

    def create_once(_index):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            barrier.wait(timeout=10)
            try:
                result, _ = service.create_appointment(db, tenant, tenant, body, str(uuid4()))
                return result
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_once, range(2)))
    assert sorted(results) == [201, 409]
    with Session(owner_engine) as db:
        assert db.query(Appointment).filter_by(tenant_id=tenant).count() == 1
        assert db.query(AppointmentHistory).filter_by(tenant_id=tenant).count() == 1
        assert db.query(AppointmentReminder).filter_by(tenant_id=tenant).count() == 1


def test_runtime_sql_rls_immutable_history_identity_and_timezone(client, db, kova_app_engine):
    from sqlalchemy.exc import DBAPIError

    from app.db import set_tenant_context

    tenants = []
    appointments = []
    for _ in range(2):
        account, customer = setup(client)
        selected = resource(client)
        row = book(client, customer, selected)
        tenants.append(UUID(account["tenant_id"]))
        appointments.append(row)
    set_tenant_context(db, tenants[0])
    db.execute(text("SET LOCAL ROLE kova_app"))
    assert db.execute(text("SELECT id FROM appointments")).scalars().all() == [
        UUID(appointments[0]["id"])
    ]
    assert (
        db.execute(
            text("UPDATE appointments SET version=version+1 WHERE id=:id"),
            {"id": UUID(appointments[1]["id"])},
        ).rowcount
        == 0
    )
    for statement in (
        "UPDATE appointments SET customer_id=:value WHERE id=:id",
        "UPDATE appointment_resources SET timezone='America/Cancun'",
        "UPDATE appointment_history SET action='changed'",
        "DELETE FROM appointments WHERE id=:id",
    ):
        with pytest.raises(DBAPIError):
            with db.begin_nested():
                db.execute(text(statement), {"id": UUID(appointments[0]["id"]), "value": uuid4()})
    for table in (
        "appointment_resources",
        "appointments",
        "appointment_history",
        "appointment_reminders",
    ):
        flags = db.execute(
            text("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:table"),
            {"table": table},
        ).one()
        assert flags.relrowsecurity and flags.relforcerowsecurity
    # No context denies the same real runtime session.
    db.execute(text("SELECT set_config('app.tenant_id','',true)"))
    assert db.execute(text("SELECT id FROM appointments")).all() == []


def test_appointment_history_and_reminder_share_rollback_with_booking(client, db, monkeypatch):
    from app.appointments.schemas import AppointmentCreate

    _account, customer = setup(client)
    selected = resource(client)
    body = AppointmentCreate(**booking_body(customer, selected))
    original = service._record_change

    def fail_after_history(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("Synthetic journal failure")

    monkeypatch.setattr(service, "_record_change", fail_after_history)
    with pytest.raises(RuntimeError, match="Synthetic journal failure"):
        with db.begin_nested():
            service.create_appointment(
                db, UUID(_account["tenant_id"]), UUID(_account["user_id"]), body, "booking-rollback"
            )
    assert db.query(Appointment).count() == 0
    assert db.query(AppointmentHistory).count() == 0
    assert db.query(AppointmentReminder).count() == 0
    monkeypatch.setattr(service, "_record_change", original)
    status, result = service.create_appointment(
        db, UUID(_account["tenant_id"]), UUID(_account["user_id"]), body, "booking-rollback"
    )
    assert status == 201 and result["version"] == 1
    assert db.query(Appointment).count() == 1


def test_reminder_rejects_early_resolution_and_timezone_replay_is_identical(client, db):
    _account, customer = setup(client)
    selected = resource(client)
    start = datetime.now(UTC) + timedelta(days=3)
    created = post(client, "", booking_body(customer, selected, start=start), "timezone-booking")
    assert created.status_code == 201, created.text
    row = created.json()
    assert client.get(BASE + "/reminders").json()["items"] == []
    reminder = db.query(AppointmentReminder).filter_by(appointment_id=UUID(row["id"])).one()
    assert (
        post(
            client,
            f"/reminders/{reminder.id}/resolve",
            {"expected_version": 1, "status": "completed"},
        ).status_code
        == 409
    )
    db.execute(text("SET LOCAL TIME ZONE 'America/Mexico_City'"))
    replay = post(client, "", booking_body(customer, selected, start=start), "timezone-booking")
    assert replay.status_code == 201 and replay.json() == row
    reread = client.get(BASE).json()["items"][0]
    assert reread == row

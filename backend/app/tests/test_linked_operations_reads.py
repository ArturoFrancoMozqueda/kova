"""Direct links read their owned record, including records outside a sampled queue."""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest

from app.appointments import service as appointments
from app.audit.models import AuditLog
from app.auth.models import Membership
from app.billing.models import Subscription
from app.idempotency.models import IdempotencyKey
from app.service_cases.models import ServiceCaseEvent
from app.tests.test_operations_queue import STAMP, seed, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
PATHS = (
    ("/api/v1/crm/opportunities", 1),
    ("/api/v1/crm/followups", 2),
    ("/api/v1/appointments/reminders", 4),
)


@pytest.mark.parametrize("path,index", PATHS)
def test_direct_read_returns_existing_owned_record_without_domain_writes(
    client, db, monkeypatch, path, index
):
    monkeypatch.setattr(appointments, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    rows = seed(db, tenant, customer, actor)
    before = (
        db.query(AuditLog).count(),
        db.query(IdempotencyKey).count(),
        db.query(ServiceCaseEvent).count(),
    )
    response = client.get(f"{path}/{rows[index].id}")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(rows[index].id)
    expected_title = rows[3].title if index == 4 else rows[index].title
    assert response.json()["title"] == expected_title
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert client.get(f"{path}/{uuid4()}").status_code == 404
    assert client.get(f"{path}/invalid-id").status_code == 422
    assert before == (
        db.query(AuditLog).count(),
        db.query(IdempotencyKey).count(),
        db.query(ServiceCaseEvent).count(),
    )
    assert rows[index].version == 1


@pytest.mark.parametrize("path,index", PATHS)
def test_direct_reads_reject_other_branch_and_tenant(client, db, monkeypatch, path, index):
    monkeypatch.setattr(appointments, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    original = seed(db, tenant, customer, actor)
    branch_response = client.post(
        "/api/v1/branches",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Lectura norte"},
    )
    assert branch_response.status_code == 201, branch_response.text
    branch_id = branch_response.json()["id"]
    other = seed(db, tenant, customer, actor, branch=UUID(branch_id))
    assert client.get(f"{path}/{other[index].id}").status_code == 404
    assert (
        client.get(f"{path}/{other[index].id}", headers={"X-Kova-Branch": branch_id}).status_code
        == 200
    )
    assert (
        client.get(f"{path}/{original[index].id}", headers={"X-Kova-Branch": branch_id}).status_code
        == 404
    )
    setup(client, db)
    assert client.get(f"{path}/{original[index].id}").status_code == 404
    assert client.get(f"{path}/{other[index].id}").status_code == 404


@pytest.mark.parametrize("path,index", PATHS)
def test_direct_reads_preserve_roles_billing_and_cookie_auth(client, db, monkeypatch, path, index):
    monkeypatch.setattr(appointments, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    rows = seed(db, tenant, customer, actor)
    url = f"{path}/{rows[index].id}"
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "manager"
    db.commit()
    assert client.get(url).status_code == 200
    member.role = "cashier"
    db.commit()
    assert client.get(url).status_code == 403
    member.role = "owner"
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(url).status_code == 402
    client.cookies.clear()
    assert client.get(url).status_code == 401


@pytest.mark.parametrize(
    "state",
    ["future", "completed", "dismissed", "suppressed", "appointment_closed", "stale_version"],
)
def test_reminder_link_only_reads_current_available_pending_reminder(
    client, db, monkeypatch, state
):
    monkeypatch.setattr(appointments, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    rows = seed(db, tenant, customer, actor)
    appointment, reminder = rows[3:]
    if state == "future":
        reminder.due_at = STAMP + timedelta(seconds=1)
    elif state == "appointment_closed":
        appointment.status = "completed"
    elif state == "stale_version":
        appointment.version += 1
    else:
        reminder.status = state
    db.commit()
    previous = (reminder.status, reminder.version, reminder.due_at)
    response = client.get(f"/api/v1/appointments/reminders/{reminder.id}")
    assert response.status_code == 404, response.text
    db.refresh(reminder)
    assert (reminder.status, reminder.version, reminder.due_at) == previous


@pytest.mark.parametrize("path,index", PATHS)
def test_direct_helpers_keep_real_runtime_rls_across_two_populated_tenants(
    client, db, monkeypatch, kova_app_engine, path, index
):
    from fastapi import HTTPException
    from sqlalchemy import text

    from app.branches.scope import bind_branch
    from app.crm import engagement
    from app.crm import service as crm
    from app.db import set_tenant_context

    monkeypatch.setattr(appointments, "now", lambda: STAMP)
    first, customer, actor = setup(client, db)
    original = seed(db, first, customer, actor)
    second, customer, actor = setup(client, db)
    other = seed(db, second, customer, actor)
    helper = {1: crm.get_opportunity, 2: engagement.get_followup, 4: appointments.get_reminder}[
        index
    ]
    model = type(original[index])
    original_id, other_id = original[index].id, other[index].id
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        set_tenant_context(db, first)
        bind_branch(db, tenant_id=first)
        assert helper(db, first, original_id)["id"] == str(original_id)
        assert db.query(model.id).filter(model.id == other_id).first() is None
        with pytest.raises(HTTPException) as unavailable:
            helper(db, first, other_id)
        assert unavailable.value.status_code == 404
        set_tenant_context(db, second)
        bind_branch(db, tenant_id=second)
        assert helper(db, second, other_id)["id"] == str(other_id)
        assert db.query(model.id).filter(model.id == original_id).first() is None
        with pytest.raises(HTTPException) as unavailable:
            helper(db, second, original_id)
        assert unavailable.value.status_code == 404
    finally:
        db.execute(text("RESET ROLE"))

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text

from app.appointments.models import Appointment, AppointmentReminder, AppointmentResource
from app.audit.models import AuditLog
from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.crm.engagement_models import FollowupTask
from app.crm.models import Opportunity
from app.customers.models import Customer
from app.db import set_tenant_context
from app.idempotency.models import IdempotencyKey
from app.operations_queue import service
from app.service_cases.models import ServiceCase, ServiceCaseEvent
from app.tests.test_customer_orders import _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/operations/queue"
SOURCES = ["service_cases", "opportunities", "followups", "appointment_reminders"]
STAMP = datetime(2026, 10, 19, 18, tzinfo=UTC)


def setup(client, db):
    tenant = _signup_login(client, prefix="operations-queue")
    customer = Customer(
        tenant_id=tenant, name="Cliente de la cola", phone="5512345678", email="private@example.com"
    )
    db.add(customer)
    db.flush()
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    db.commit()
    return tenant, customer, member.user_id


def seed(db, tenant, customer, actor, *, branch=None, suffix="", due=STAMP - timedelta(hours=1)):
    branch = branch or tenant
    bind_branch(db, tenant_id=tenant, branch_id=branch)
    case = ServiceCase(
        tenant_id=tenant,
        branch_id=branch,
        customer_id=customer.id,
        title=f"Atención real{suffix}",
        created_by_user_id=actor,
        due_at=due,
    )
    opportunity = Opportunity(
        tenant_id=tenant,
        branch_id=branch,
        customer_id=customer.id,
        title=f"Oportunidad real{suffix}",
        estimated_amount=Decimal("12345.67"),
        next_action="Confirmar fecha",
        note="Nota privada de oportunidad",
        due_at=due,
        created_by_user_id=actor,
        updated_by_user_id=actor,
    )
    followup = FollowupTask(
        tenant_id=tenant,
        branch_id=branch,
        customer_id=customer.id,
        kind="incident",
        title=f"Seguimiento real{suffix}",
        note="Nota privada de seguimiento",
        due_at=due or STAMP + timedelta(days=1),
    )
    resource = AppointmentResource(
        tenant_id=tenant,
        branch_id=branch,
        name=f"Recurso {uuid4()}",
        timezone="America/Mexico_City",
    )
    db.add_all([case, opportunity, followup, resource])
    db.flush()
    appointment = Appointment(
        tenant_id=tenant,
        branch_id=branch,
        resource_id=resource.id,
        customer_id=customer.id,
        title=f"Cita real{suffix}",
        starts_at=STAMP + timedelta(hours=2),
        ends_at=STAMP + timedelta(hours=3),
        note="Nota privada de cita",
        created_by_user_id=actor,
    )
    db.add(appointment)
    db.flush()
    reminder = AppointmentReminder(
        tenant_id=tenant,
        branch_id=branch,
        appointment_id=appointment.id,
        appointment_version=appointment.version,
        due_at=due or STAMP + timedelta(days=1),
    )
    db.add(reminder)
    db.commit()
    db.info.pop("kova_branch_id", None)
    return case, opportunity, followup, appointment, reminder


def by_source(result):
    return {section["source"]: section for section in result["sections"]}


def read(client):
    response = client.get(BASE)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    return response.json()


def test_empty_queue_is_four_bounded_sections_without_inferred_totals_or_writes(
    client, db, monkeypatch
):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    setup(client, db)
    before = (db.query(AuditLog).count(), db.query(IdempotencyKey).count())
    result = read(client)
    assert datetime.fromisoformat(result["generated_at"]) == STAMP
    assert [section["source"] for section in result["sections"]] == SOURCES
    assert all(
        section == {"source": source, "items": [], "has_more": False}
        for source, section in zip(SOURCES, result["sections"], strict=True)
    )
    assert set(result) == {"generated_at", "sections"}
    assert (db.query(AuditLog).count(), db.query(IdempotencyKey).count()) == before


def test_projection_uses_real_fields_and_never_exposes_notes_contacts_or_amounts(
    client, db, monkeypatch
):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    case, opportunity, followup, appointment, reminder = seed(db, tenant, customer, actor)
    result = read(client)
    rows = by_source(result)
    for source, model, route in (
        ("service_cases", case, "service_cases"),
        ("opportunities", opportunity, "crm"),
        ("followups", followup, "followups"),
        ("appointment_reminders", reminder, "appointments"),
    ):
        item = rows[source]["items"][0]
        assert set(item) == {
            "source_id",
            "title",
            "customer_name",
            "state",
            "version",
            "due_at",
            "overdue",
            "route_key",
        }
        assert item["source_id"] == str(model.id)
        assert item["title"] == (
            appointment.title if source == "appointment_reminders" else model.title
        )
        assert item["customer_name"] == customer.name
        assert item["route_key"] == route
        assert item["overdue"] is True
        assert item["version"] == model.version
        assert rows[source]["has_more"] is False
    serialized = str(result)
    for private in (
        customer.phone,
        customer.email,
        "12345.67",
        "Nota privada",
        "next_action",
        "note",
        "href",
        "url",
        "total",
    ):
        assert private not in serialized
    assert db.query(ServiceCaseEvent).filter_by(tenant_id=tenant).count() == 0


def test_eligibility_excludes_closed_or_actionless_records_and_stale_reminders(
    client, db, monkeypatch
):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    records = [seed(db, tenant, customer, actor, suffix=str(i)) for i in range(6)]
    records[0][0].status, records[0][0].resolved_at = "resolved", STAMP
    records[1][0].status, records[1][0].resolved_at = "cancelled", STAMP
    for i, value in enumerate((None, "", " \t\r\n")):
        records[i][1].next_action = value
    records[3][1].stage = "won"
    records[4][1].stage = "lost"
    records[0][2].status = "completed"
    records[1][2].status = "dismissed"
    records[0][3].status = "cancelled"
    records[1][3].status = "completed"
    records[2][3].status = "no_show"
    records[3][3].version += 1
    records[4][4].due_at = STAMP + timedelta(seconds=1)
    db.commit()
    result = by_source(read(client))
    assert len(result["service_cases"]["items"]) == 4
    assert [r["source_id"] for r in result["opportunities"]["items"]] == [str(records[5][1].id)]
    assert len(result["followups"]["items"]) == 4
    assert [r["source_id"] for r in result["appointment_reminders"]["items"]] == [
        str(records[5][4].id)
    ]
    assert records[3][4].status == "pending"  # Reading never suppresses or repairs source records.


def test_sections_order_by_due_then_id_null_dates_last_and_has_more_is_not_a_total(
    client, db, monkeypatch
):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    rows = [seed(db, tenant, customer, actor, suffix=str(i)) for i in range(21)]
    result = by_source(read(client))
    for source, index in (
        ("service_cases", 0),
        ("opportunities", 1),
        ("followups", 2),
        ("appointment_reminders", 4),
    ):
        assert len(result[source]["items"]) == 20
        assert result[source]["has_more"] is True
        assert [r["source_id"] for r in result[source]["items"]] == sorted(
            str(row[index].id) for row in rows
        )[:20]
    for case, opportunity, *_ in rows:
        case.due_at = None
        opportunity.due_at = None
    rows[0][0].due_at = STAMP
    rows[0][1].due_at = STAMP
    db.commit()
    result = by_source(read(client))
    assert result["service_cases"]["items"][0]["source_id"] == str(rows[0][0].id)
    assert result["opportunities"]["items"][0]["source_id"] == str(rows[0][1].id)
    assert all(not r["overdue"] for r in result["service_cases"]["items"])
    assert result["service_cases"]["items"][1]["due_at"] is None


def test_two_branches_and_businesses_only_see_current_scope(client, db, monkeypatch):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    original = seed(db, tenant, customer, actor)
    branch = client.post(
        "/api/v1/branches", headers={"Idempotency-Key": str(uuid4())}, json={"name": "Cola norte"}
    ).json()
    other = seed(db, tenant, customer, actor, branch=UUID(branch["id"]), suffix=" norte")
    result = read(client)
    assert by_source(result)["service_cases"]["items"][0]["source_id"] == str(original[0].id)
    branch_result = client.get(BASE, headers={"X-Kova-Branch": branch["id"]})
    assert branch_result.status_code == 200, branch_result.text
    assert by_source(branch_result.json())["service_cases"]["items"][0]["source_id"] == str(
        other[0].id
    )
    setup(client, db)
    assert all(not section["items"] for section in read(client)["sections"])


def test_cashier_unauthenticated_and_blocked_billing_cannot_read_queue(client, db):
    tenant, _, _ = setup(client, db)
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE).status_code == 403
    member.role = "manager"
    db.commit()
    assert client.get(BASE).status_code == 200
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(BASE).status_code == 402
    client.cookies.clear()
    assert client.get(BASE).status_code == 401


def test_runtime_projection_rls_rejects_foreign_scope_even_if_called_directly(
    client, db, kova_app_engine, monkeypatch
):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    source = seed(db, tenant, customer, actor)
    foreign_tenant, foreign_customer, foreign_actor = setup(client, db)
    foreign_source = seed(db, foreign_tenant, foreign_customer, foreign_actor)
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    own = service.read_queue(db, tenant_id=tenant).model_dump(mode="json")
    assert by_source(own)["service_cases"]["items"][0]["source_id"] == str(source[0].id)
    foreign = service.read_queue(db, tenant_id=foreign_tenant)
    assert all(not section.items for section in foreign.sections)
    set_tenant_context(db, foreign_tenant)
    allowed = service.read_queue(db, tenant_id=foreign_tenant).model_dump(mode="json")
    assert by_source(allowed)["service_cases"]["items"][0]["source_id"] == str(foreign_source[0].id)
    assert all(not section.items for section in service.read_queue(db, tenant_id=tenant).sections)
    db.execute(text("RESET ROLE"))


def test_service_executes_four_projected_selects_limited_to_twenty_one(client, db, monkeypatch):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    tenant, customer, actor = setup(client, db)
    seed(db, tenant, customer, actor)
    statements = []

    def capture(_conn, _cursor, statement, parameters, _context, _many):
        statements.append((statement, parameters))

    connection = db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    try:
        service.read_queue(db, tenant_id=tenant)
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    assert len(statements) == 4
    for statement, parameters in statements:
        assert statement.lstrip().startswith("SELECT")
        assert "LIMIT" in statement
        assert 21 in (parameters.values() if isinstance(parameters, dict) else parameters)
        for forbidden in (".note", ".email", ".phone", "estimated_amount", "total_amount"):
            assert forbidden not in statement

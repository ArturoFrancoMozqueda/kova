from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.automations import service
from app.automations.models import AutomationRule, AutomationRun, BusinessEvent
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.db import set_tenant_context
from app.service_cases.models import ServiceCase
from app.tests.test_service_cases import create, patch, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/automations"
STAMP = datetime(2026, 10, 20, 12, tzinfo=UTC)


def enable(client, monkeypatch):
    monkeypatch.setattr(service, "now", lambda: STAMP)
    response = client.put(
        BASE + "/rules/service_case_overdue",
        json={
            "enabled": True,
            "expected_version": 0,
        },
    )
    assert response.status_code == 200, response.text
    monkeypatch.setattr(service, "now", lambda: STAMP + timedelta(hours=1))


def make(client, customer, *, delta=1):
    response = create(client, customer, due_at=(STAMP + timedelta(minutes=delta)).isoformat())
    assert response.status_code == 201, response.text
    return response.json()


def process(client):
    response = client.post(BASE + "/process")
    assert response.status_code == 200, response.text
    return response.json()


def test_deadline_opt_in_no_retroactivity_and_no_duplicate_for_notes(client, db, monkeypatch):
    tenant, customer = setup(client)
    old = make(client, customer, delta=-1)
    current = make(client, customer)
    assert process(client)["created"] == 0
    enable(client, monkeypatch)
    assert process(client)["created"] == 1
    task = client.get(BASE).json()["runs"][0]
    assert task["entity_type"] == "service_case" and task["entity_id"] == current["id"]
    assert task["entity_id"] != old["id"]
    assert task["entity_version"] == int((STAMP + timedelta(minutes=1)).timestamp()) * 1_000_000
    note = client.post(
        f"/api/v1/service-cases/{current['id']}/notes",
        headers={"Idempotency-Key": str(uuid4())},
        json={"expected_version": current["version"], "note": "Privada"},
    )
    assert note.status_code == 200
    assert process(client)["created"] == 0
    resolved = client.post(
        BASE + f"/runs/{task['id']}/resolve",
        json={
            "expected_version": 1,
            "status": "completed",
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert process(client)["created"] == 0
    event = db.query(BusinessEvent).filter_by(tenant_id=tenant).one()
    assert event.event_type == "service_case.review_due"
    assert event.entity_id == db.query(ServiceCase.id).filter_by(id=event.entity_id).scalar()


def test_rescheduling_resolution_and_pause_suppress_without_changing_case(client, monkeypatch):
    _, customer = setup(client)
    enable(client, monkeypatch)
    row = make(client, customer)
    assert process(client)["created"] == 1
    task = client.get(BASE).json()["runs"][0]
    changed = patch(client, row, due_at=(STAMP + timedelta(minutes=2)).isoformat())
    assert changed.status_code == 200
    assert (
        client.post(
            BASE + f"/runs/{task['id']}/resolve",
            json={
                "expected_version": 1,
                "status": "completed",
            },
        ).status_code
        == 409
    )
    assert process(client) == {"created": 1, "processed": 1, "suppressed": 1}
    changed = patch(client, changed.json(), status="resolved")
    assert changed.status_code == 200
    assert process(client)["suppressed"] == 1
    reopened = patch(client, changed.json(), status="reopened")
    assert reopened.status_code == 200
    assert process(client)["created"] == 0  # Same reviewed deadline is not replayed.
    fresh = make(client, customer, delta=3)
    assert process(client)["created"] == 1
    paused = client.put(
        BASE + "/rules/service_case_overdue",
        json={
            "enabled": False,
            "expected_version": 1,
        },
    )
    assert paused.status_code == 200
    assert all(r["status"] == "suppressed" for r in client.get(BASE).json()["runs"])
    assert client.get(f"/api/v1/service-cases/{fresh['id']}").json()["status"] == "open"


def test_bounded_scan_does_not_starve_unseen_cases_and_ignores_future_null(client, db, monkeypatch):
    tenant, customer = setup(client)
    enable(client, monkeypatch)
    for delta in (1, 2, 3):
        make(client, customer, delta=delta)
    make(client, customer, delta=120)
    assert create(client, customer).status_code == 201
    bind_branch(db, tenant_id=tenant)
    for _ in range(3):
        assert service.process_pending(db, tenant_id=tenant, limit=1)["created"] == 1
    assert service.process_pending(db, tenant_id=tenant, limit=1)["created"] == 0
    assert db.query(AutomationRun).filter_by(tenant_id=tenant).count() == 3


def test_author_revocation_and_billing_remain_enforced(client, db, monkeypatch):
    tenant, customer = setup(client)
    enable(client, monkeypatch)
    make(client, customer)
    assert process(client)["created"] == 1
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.flush()
    bind_branch(db, tenant_id=tenant)
    assert service.process_pending(db, tenant_id=tenant)["suppressed"] == 1
    assert client.get(BASE).status_code == 403
    member.role = "manager"
    db.commit()
    assert client.get(BASE).status_code == 200
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.post(BASE + "/process").status_code == 402
    bind_branch(db, tenant_id=tenant)
    assert service.process_pending(db, tenant_id=tenant)["created"] == 0


def test_branch_scope_and_real_runtime_rls(client, db, monkeypatch, kova_app_engine):
    tenant, customer = setup(client)
    enable(client, monkeypatch)
    make(client, customer)
    other = client.post(
        "/api/v1/branches",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Otra sucursal atención"},
    ).json()
    assert (
        client.post(BASE + "/process", headers={"X-Kova-Branch": other["id"]}).json()["created"]
        == 0
    )
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    bind_branch(db, tenant_id=tenant)
    assert service.process_pending(db, tenant_id=tenant)["created"] == 1
    set_tenant_context(db, uuid4())
    assert db.query(AutomationRun).count() == 0
    assert db.query(ServiceCase).count() == 0
    db.execute(text("RESET ROLE"))


@pytest.fixture
def committed_deadline_case(owner_engine):
    from app.customers.models import Customer
    from app.tenants.models import Tenant

    tenant = uuid4()
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent deadline", slug=f"deadline-{tenant}"))
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                "VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant, "email": f"deadline-{tenant}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant},
        )
        customer = Customer(tenant_id=tenant, name="Private customer")
        db.add(customer)
        db.flush()
        due = datetime.now(UTC) - timedelta(minutes=1)
        db.add(
            AutomationRule(
                tenant_id=tenant,
                branch_id=tenant,
                template_key="service_case_overdue",
                enabled=True,
                version=1,
                authorized_by_user_id=tenant,
                enabled_since=due - timedelta(minutes=1),
            )
        )
        db.add(
            ServiceCase(
                tenant_id=tenant,
                branch_id=tenant,
                customer_id=customer.id,
                title="Private case",
                due_at=due,
                created_by_user_id=tenant,
            )
        )
        db.commit()
    try:
        yield tenant
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "automation_runs",
                "business_events",
                "automation_rules",
                "audit_logs",
                "service_cases",
                "customers",
                "memberships",
                "branches",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": tenant})


def test_two_runtime_workers_create_one_review(kova_app_engine, committed_deadline_case):
    tenant = committed_deadline_case

    def run(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            result = service.process_pending(db, tenant_id=tenant)
            db.commit()
            return result["created"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(run, range(2))) == [0, 1]


def test_actual_other_tenant_and_branch_cannot_generate_or_resolve_review(client, db, monkeypatch):
    first, customer = setup(client)
    enable(client, monkeypatch)
    make(client, customer)
    assert process(client)["created"] == 1
    task = client.get(BASE).json()["runs"][0]
    second, other_customer = setup(client)
    enable(client, monkeypatch)
    make(client, other_customer)
    assert process(client)["created"] == 1
    assert (
        client.post(
            BASE + f"/runs/{task['id']}/resolve",
            json={
                "expected_version": 1,
                "status": "completed",
            },
        ).status_code
        == 404
    )
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, second)
    assert {r.tenant_id for r in db.query(ServiceCase).all()} == {second}
    assert {r.tenant_id for r in db.query(AutomationRun).all()} == {second}
    assert first != second
    db.execute(text("RESET ROLE"))


def test_two_runtime_resolutions_are_idempotent(
    kova_app_engine, owner_engine, committed_deadline_case
):
    from app.audit.models import AuditLog

    tenant = committed_deadline_case
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service.process_pending(db, tenant_id=tenant)["created"] == 1
        run_id = db.query(AutomationRun.id).scalar()
        db.commit()

    def resolve(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            response = service.resolve(
                db,
                tenant_id=tenant,
                user_id=tenant,
                run_id=run_id,
                expected_version=1,
                status="completed",
            )
            db.commit()
            return response.version

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(resolve, range(2))) == [2, 2]
    # Audit history remains insert-only for runtime; verify it with the fixture owner.
    with Session(owner_engine) as db:
        assert (
            db.query(AuditLog).filter_by(tenant_id=tenant, action="automation.run.resolved").count()
            == 1
        )


def test_obsolete_review_not_starved_by_valid_pending_batch(client, db, monkeypatch):
    tenant, customer = setup(client)
    enable(client, monkeypatch)
    make(client, customer, delta=1)
    obsolete = make(client, customer, delta=2)
    assert process(client)["created"] == 2
    assert patch(client, obsolete, status="resolved").status_code == 200
    bind_branch(db, tenant_id=tenant)
    assert service.process_pending(db, tenant_id=tenant, limit=1)["suppressed"] == 1
    assert db.query(AutomationRun).filter_by(tenant_id=tenant, status="pending").count() == 1


def test_source_validation_serializes_case_closure_until_resolution_commit(
    kova_app_engine, committed_deadline_case
):
    from threading import Event

    from sqlalchemy import event
    from sqlalchemy.exc import DBAPIError

    tenant = committed_deadline_case
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert service.process_pending(db, tenant_id=tenant)["created"] == 1
        run_id = db.query(AutomationRun.id).scalar()
        case_id = db.query(ServiceCase.id).scalar()
        db.commit()
    source_read, release = Event(), Event()

    def pause_after_source_read(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT service_cases.id"):
            source_read.set()
            assert release.wait(5), "Resolution source read was not released"

    def resolve():
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            result = service.resolve(
                db,
                tenant_id=tenant,
                user_id=tenant,
                run_id=run_id,
                expected_version=1,
                status="completed",
            )
            db.commit()
            return result.status

    event.listen(kova_app_engine, "after_cursor_execute", pause_after_source_read)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(resolve)
            try:
                assert source_read.wait(5)
                with Session(kova_app_engine) as db:
                    set_tenant_context(db, tenant)
                    db.execute(text("SET LOCAL lock_timeout='150ms'"))
                    # A concurrent case close cannot commit between source check and task commit.
                    with pytest.raises(DBAPIError, match="lock timeout"):
                        db.execute(
                            text(
                                "UPDATE service_cases SET status='resolved',"
                                "resolved_at=now(),version=version+1 WHERE id=:id"
                            ),
                            {"id": case_id},
                        )
                        db.commit()
                    db.rollback()
            finally:
                release.set()
            assert future.result(timeout=5) == "completed"
    finally:
        release.set()
        event.remove(kova_app_engine, "after_cursor_execute", pause_after_source_read)

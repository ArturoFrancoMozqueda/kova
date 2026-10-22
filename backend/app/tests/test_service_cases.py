from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.audit.models import AuditLog
from app.auth.models import Membership, User
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.customers.models import Customer
from app.db import set_tenant_context
from app.orders.models import Order, Payment
from app.service_cases import service
from app.service_cases.models import ServiceCase, ServiceCaseEvent
from app.tests.test_customer_orders import _product, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/service-cases"


def key():
    return {"Idempotency-Key": str(uuid4())}


def setup(client):
    tenant = _signup_login(client, prefix="service-case")
    response = client.post(
        "/api/v1/customers", headers=key(), json={"name": "Cliente atención", "phone": "5512345678"}
    )
    assert response.status_code == 201, response.text
    return tenant, response.json()


def create(client, customer, **extra):
    return client.post(
        BASE,
        headers=key(),
        json={
            "customer_id": customer["id"],
            "title": "Revisar entrega",
            "note": "El cliente necesita aclarar la entrega",
            **extra,
        },
    )


def patch(client, case, **extra):
    return client.patch(
        f"{BASE}/{case['id']}", headers=key(), json={"expected_version": case["version"], **extra}
    )


def test_create_replay_history_notes_and_audit_keep_private_data_out_of_logs(client, db):
    tenant, customer = setup(client)
    body = {
        "customer_id": customer["id"],
        "title": "Pedido especial para Ana",
        "note": "Teléfono privado y aclaración de entrega",
    }
    headers = key()
    first = client.post(BASE, headers=headers, json=body)
    assert first.status_code == 201, first.text
    row = first.json()
    assert row["status"] == "open" and row["version"] == 1 and row["overdue"] is False
    assert client.post(BASE, headers=headers, json=body).json() == row
    assert client.post(BASE, headers=headers, json={**body, "note": "Distinto"}).status_code == 400
    note_body = {"expected_version": 1, "note": "Respuesta privada adicional"}
    note_headers = key()
    note = client.post(f"{BASE}/{row['id']}/notes", headers=note_headers, json=note_body)
    assert note.status_code == 200, note.text
    assert note.json()["version"] == 2
    assert (
        client.post(f"{BASE}/{row['id']}/notes", headers=note_headers, json=note_body).json()
        == note.json()
    )
    history = client.get(f"{BASE}/{row['id']}/events").json()["items"]
    assert [e["kind"] for e in history] == ["note_added", "created"]
    assert history[1]["note"] == body["note"]
    assert len({e["actor_user_id"] for e in history}) == 1
    audit = (
        db.query(AuditLog)
        .filter_by(tenant_id=tenant)
        .filter(AuditLog.action.like("service_case.%"))
        .all()
    )
    assert len(audit) == 2
    assert "privad" not in str([a.changes for a in audit])
    assert "Ana" not in str([a.changes for a in audit])


def test_lifecycle_overdue_and_reopening_use_real_clock_and_versions(client, db):
    _, customer = setup(client)
    first = create(client, customer, due_at=(datetime.now(UTC) - timedelta(hours=1)).isoformat())
    assert first.status_code == 201, first.text
    row = first.json()
    assert row["overdue"] is True
    assert len(client.get(BASE + "?overdue_only=true").json()["items"]) == 1
    assigned = patch(client, row, status="in_progress")
    assert assigned.status_code == 200, assigned.text
    resolved = patch(client, assigned.json(), status="resolved")
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolved_at"] is not None and resolved.json()["overdue"] is False
    assert client.get(BASE + "?overdue_only=true").json()["items"] == []
    stale = patch(client, assigned.json(), status="resolved")
    assert stale.status_code == 409
    reopened = patch(client, resolved.json(), status="reopened")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["resolved_at"] is None and reopened.json()["overdue"] is True
    cancelled = patch(client, reopened.json(), status="cancelled")
    assert cancelled.status_code == 200
    assert patch(client, cancelled.json(), status="reopened").status_code == 409
    assert (
        client.post(
            f"{BASE}/{row['id']}/notes",
            headers=key(),
            json={
                "expected_version": cancelled.json()["version"],
                "note": "Constancia posterior al cierre",
            },
        ).status_code
        == 200
    )
    assert db.query(ServiceCaseEvent).filter_by(case_id=UUID(row["id"])).count() == 6


def test_assignment_only_active_members_of_current_branch_and_deactivation_visible(client, db):
    tenant, customer = setup(client)
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    assert client.get(BASE + "/assignees").json()["items"][0]["user_id"] == str(member.user_id)
    row = create(client, customer, assigned_user_id=str(member.user_id)).json()
    assert row["assignee_active"] is True
    unavailable = User(
        id=uuid4(),
        email=f"unavailable-{uuid4()}@example.com",
        hashed_password="test-only",
        is_email_verified=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(unavailable)
    db.flush()
    db.add(
        Membership(
            tenant_id=tenant,
            user_id=unavailable.id,
            role="cashier",
            is_active=False,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()
    assert patch(client, row, assigned_user_id=str(unavailable.id)).status_code == 404
    other = client.post("/api/v1/branches", headers=key(), json={"name": "Restringida"}).json()
    unavailable_member = (
        db.query(Membership).filter_by(tenant_id=tenant, user_id=unavailable.id).one()
    )
    unavailable_member.is_active = True
    unavailable_member.allowed_branch_id = UUID(other["id"])
    db.commit()
    assert patch(client, row, assigned_user_id=str(unavailable.id)).status_code == 404
    unavailable_member.allowed_branch_id = None
    db.commit()
    assigned = patch(client, row, assigned_user_id=str(unavailable.id))
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignee_active"] is True
    unavailable_member.is_active = False
    db.commit()
    current = client.get(f"{BASE}/{row['id']}").json()
    assert current["assigned_user_id"] == str(unavailable.id)
    assert current["assignee_active"] is False
    assert client.get(BASE).json()["items"][0]["assignee_active"] is False
    row = current
    member.role = "manager"
    db.commit()
    assert client.get(BASE + "/assignees").status_code == 200
    assert client.get("/api/v1/employees").status_code == 403
    assert patch(client, row, assigned_user_id=None).status_code == 200


def test_sources_must_have_explicit_customer_and_same_branch_and_do_not_mutate_money(client, db):
    tenant, customer = setup(client)
    own = Order(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=UUID(customer["id"]),
        subtotal_amount=Decimal("10"),
        total_amount=Decimal("10"),
        status="voided",
    )
    other = Customer(tenant_id=tenant, name="Otro cliente")
    db.add_all([own, other])
    db.flush()
    unrelated = Order(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=other.id,
        subtotal_amount=Decimal("10"),
        total_amount=Decimal("10"),
    )
    db.add(unrelated)
    db.commit()
    assert create(client, customer, sale_order_id=str(unrelated.id)).status_code == 404
    valid = create(client, customer, sale_order_id=str(own.id))
    assert valid.status_code == 201, valid.text
    assert valid.json()["sale_order_id"] == str(own.id)
    assert own.total_amount == Decimal("10") and own.status == "voided"
    assert db.query(Payment).filter_by(tenant_id=tenant).count() == 0
    product = _product(client)
    ambiguous = client.post(
        "/api/v1/customer-orders",
        headers=key(),
        json={
            "fulfillment_type": "pickup",
            "source_channel": "counter",
            "customer_name": customer["name"],
            "items": [{"product_id": product["id"], "quantity": 1, "modifier_option_ids": []}],
        },
    )
    assert ambiguous.status_code == 201, ambiguous.text
    assert create(client, customer, customer_order_id=ambiguous.json()["id"]).status_code == 409
    refs = client.get(BASE + f"/references?customer_id={customer['id']}")
    assert refs.status_code == 200, refs.text
    assert [s["id"] for s in refs.json()["sales"]] == [str(own.id)]
    assert refs.json()["customer_orders"] == []


def test_quote_order_link_is_verified_and_references_are_minimal(client, db):
    from app.tests.test_quotes import create as create_quote
    from app.tests.test_quotes import setup as setup_quote

    tenant, customer, product = setup_quote(client, db)
    created = create_quote(client, customer, product).json()
    sent = client.post(
        f"/api/v1/quotes/{created['id']}/mark-sent",
        headers=key(),
        json={"expected_version": 1, "confirmed_shared": True},
    )
    assert sent.status_code == 200, sent.text
    accepted = client.post(
        f"/api/v1/quotes/{created['id']}/accept",
        headers=key(),
        json={"expected_version": 2, "confirmed_customer_acceptance": True},
    )
    assert accepted.status_code == 200, accepted.text
    order_id = accepted.json()["customer_order_id"]
    case = create(client, customer, customer_order_id=order_id)
    assert case.status_code == 201, case.text
    refs = client.get(BASE + f"/references?customer_id={customer['id']}").json()
    assert refs["customer_orders"][0]["id"] == order_id
    assert set(refs["customer_orders"][0]) == {"id", "folio", "status"}
    assert "customer_phone" not in str(refs)
    sale = Order(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=UUID(customer["id"]),
        subtotal_amount=Decimal("10"),
        total_amount=Decimal("10"),
    )
    db.add(sale)
    db.commit()
    assert (
        create(client, customer, customer_order_id=order_id, sale_order_id=str(sale.id)).status_code
        == 409
    )


def test_cross_tenant_and_branch_details_notes_and_references_are_private(client, db):
    tenant, customer = setup(client)
    row = create(client, customer).json()
    branch = client.post("/api/v1/branches", headers=key(), json={"name": "Otra sucursal"}).json()
    other = {"X-Kova-Branch": branch["id"]}
    assert client.get(BASE, headers=other).json()["items"] == []
    assert client.get(f"{BASE}/{row['id']}", headers=other).status_code == 404
    assert client.get(f"{BASE}/{row['id']}/events", headers=other).status_code == 404
    assert (
        client.post(
            f"{BASE}/{row['id']}/notes",
            headers={**key(), **other},
            json={"expected_version": 1, "note": "Otra sucursal"},
        ).status_code
        == 404
    )
    setup(client)
    assert client.get(BASE).json()["items"] == []
    assert client.get(f"{BASE}/{row['id']}").status_code == 404
    assert client.get(BASE + f"/references?customer_id={customer['id']}").status_code == 404
    assert create(client, customer).status_code == 404


def test_billing_roles_input_validation_and_case_history_pagination(client, db):
    tenant, customer = setup(client)
    assert create(client, customer, title=" ").status_code == 422
    assert create(client, customer, note="<script>x</script>").status_code == 422
    assert create(client, customer, due_at="2026-10-20T12:00:00").status_code == 422
    first = create(client, customer).json()
    assert (
        client.patch(
            f"{BASE}/{first['id']}",
            headers=key(),
            json={"expected_version": 1, "customer_id": customer["id"]},
        ).status_code
        == 422
    )
    assert patch(client, first, status=None).status_code == 422
    assert patch(client, first).status_code == 400
    assert client.get(f"{BASE}/{first['id']}/events?limit=1").json()["has_more"] is False
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE).status_code == 403
    assert client.get(BASE + "/assignees").status_code == 403
    member.role = "owner"
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(BASE).status_code == 402
    assert create(client, customer).status_code == 402


def test_runtime_case_history_is_append_only_and_foreign_insert_denied(client, db, kova_app_engine):
    tenant, customer = setup(client)
    first = create(client, customer)
    assert first.status_code == 201
    case_id = UUID(first.json()["id"])
    actor = db.query(Membership).filter_by(tenant_id=tenant).one().user_id
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    assert db.query(ServiceCase).filter_by(tenant_id=tenant).count() == 1
    for statement in (
        "UPDATE service_cases SET title='changed' WHERE id=:id",
        "UPDATE service_case_events SET note='changed' WHERE case_id=:id",
        "DELETE FROM service_case_events WHERE case_id=:id",
    ):
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(text(statement), {"id": case_id})
    set_tenant_context(db, uuid4())
    assert db.query(ServiceCase).count() == 0
    assert db.query(ServiceCaseEvent).count() == 0
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO service_case_events(id,tenant_id,branch_id,case_id,case_version,kind,actor_user_id,status,note,created_at) VALUES(:id,:tenant,:tenant,:case,99,'note_added',:actor,'open','foreign',now())"
            ),
            {"id": uuid4(), "tenant": tenant, "case": case_id, "actor": actor},
        )
    db.execute(text("RESET ROLE"))


@pytest.fixture
def committed_case(owner_engine):
    from sqlalchemy.orm import Session

    from app.service_cases.schemas import ServiceCaseCreate
    from app.tenants.models import Tenant

    tenant, customer = uuid4(), uuid4()
    with Session(owner_engine) as db:
        db.add(Tenant(id=tenant, name="Concurrent service", slug=f"service-{tenant}"))
        db.flush()
        db.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"
            ),
            {"id": tenant, "email": f"service-{tenant}@example.com"},
        )
        db.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
            {"id": tenant},
        )
        db.add(Customer(id=customer, tenant_id=tenant, name="Concurrent service customer"))
        db.flush()
        bind_branch(db, tenant_id=tenant)
        _, row = service.create(
            db,
            tenant,
            tenant,
            ServiceCaseCreate(
                customer_id=customer, title="Revisar caso", note="Solicitud privada inicial"
            ),
            str(uuid4()),
        )
    try:
        yield tenant, customer, UUID(row["id"])
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "service_case_events",
                "service_cases",
                "idempotency_keys",
                "audit_logs",
                "customers",
                "memberships",
                "branches",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM tenants WHERE id=:id"), {"id": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": tenant})


def test_runtime_concurrent_resolution_only_one_state_and_history_version_wins(
    kova_app_engine, committed_case
):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.service_cases.schemas import ServiceCaseUpdate

    tenant, _, case_id = committed_case

    def resolve(status):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            try:
                code, _ = service.update(
                    db,
                    tenant,
                    tenant,
                    case_id,
                    ServiceCaseUpdate(expected_version=1, status=status),
                    str(uuid4()),
                )
                return code
            except HTTPException as exc:
                db.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(resolve, ["resolved", "cancelled"])) == [200, 409]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        row = service.get(db, tenant, case_id)
        assert row["version"] == 2 and row["status"] in {"resolved", "cancelled"}
        assert row["resolved_at"] is not None
        history = service.events(db, tenant, case_id)["items"]
        assert [e["case_version"] for e in history] == [2, 1]
        assert history[0]["status"] == row["status"]


def test_runtime_concurrent_create_with_same_key_keeps_single_case_and_event(
    kova_app_engine, committed_case
):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy.orm import Session

    from app.service_cases.schemas import ServiceCaseCreate

    tenant, customer, original = committed_case
    stable_key = str(uuid4())
    body = ServiceCaseCreate(
        customer_id=customer,
        title="Duplicado en red",
        note="La misma solicitud, repetida por la red",
    )

    def submit(_):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            return service.create(db, tenant, tenant, body, stable_key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert results[0] == results[1]
    assert results[0][0] == 201
    assert results[0][1]["id"] != str(original)
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert db.query(ServiceCase).filter_by(tenant_id=tenant).count() == 2
        assert db.query(ServiceCaseEvent).filter_by(tenant_id=tenant).count() == 2


def test_due_clear_and_history_pagination_preserve_original_note(client):
    _, customer = setup(client)
    first = create(
        client, customer, due_at=(datetime.now(UTC) - timedelta(days=1)).isoformat()
    ).json()
    assert first["overdue"] is True
    cleared = patch(client, first, due_at=None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["due_at"] is None and cleared.json()["overdue"] is False
    latest = client.get(f"{BASE}/{first['id']}/events?limit=1").json()
    assert latest["has_more"] is True
    assert latest["items"][0]["kind"] == "updated"
    original = client.get(f"{BASE}/{first['id']}/events?limit=1&offset=1").json()
    assert original["has_more"] is False
    assert original["items"][0]["note"] == "El cliente necesita aclarar la entrega"
    assert original["items"][0]["due_at"] == first["due_at"]
    assert create(client, customer).status_code == 201
    listing = client.get(BASE + "?limit=1").json()
    assert listing["has_more"] is True and len(listing["items"]) == 1
    assert client.get(BASE + "?status=resolved").json()["items"] == []

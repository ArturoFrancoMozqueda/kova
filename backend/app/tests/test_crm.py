from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.config import settings
from app.crm import service
from app.crm.models import ContactConsent, Opportunity
from app.crm.schemas import ConsentWrite, OpportunityCreate, OpportunityUpdate
from app.customers.models import Customer
from app.orders.models import Order
from app.tests.test_catalog import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def setup(client):
    account = _signup_verify_login(client, f"crm-{uuid4().hex}@example.com", "CRM")
    response = client.post(
        "/api/v1/customers",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": "Ana García", "phone": "5512345678", "email": "ana@example.com"},
    )
    assert response.status_code == 201, response.text
    return account, response.json()


def create(client, customer, *, key=None, branch=None):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.post(
        "/api/v1/crm/opportunities",
        headers=headers,
        json={
            "customer_id": customer["id"],
            "title": "Pedido para oficina",
            "estimated_amount": "1250.40",
            "next_action": "Confirmar fecha",
            "note": "Solicitó opciones sin azúcar",
            "due_at": (datetime.now(UTC) + timedelta(days=2)).isoformat(),
        },
    )


def consent(
    client,
    customer,
    *,
    enabled=True,
    expected_version=0,
    channel="whatsapp",
    purpose="transactional",
    key=None,
    branch=None,
):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.put(
        "/api/v1/crm/consents",
        headers=headers,
        json={
            "customer_id": customer["id"],
            "channel": channel,
            "purpose": purpose,
            "enabled": enabled,
            "expected_version": expected_version,
        },
    )


def test_create_and_update_are_replay_safe_and_won_does_not_make_revenue(client, db):
    account, customer = setup(client)
    body = {
        "customer_id": customer["id"],
        "title": "Pedido para oficina",
        "estimated_amount": "1250.40",
    }
    headers = {"Idempotency-Key": "crm-create"}
    response = client.post("/api/v1/crm/opportunities", json=body, headers=headers)
    assert response.status_code == 201, response.text
    row = response.json()
    assert client.post("/api/v1/crm/opportunities", json=body, headers=headers).json() == row
    assert row["customer_name"] == "Ana García"
    assert row["estimated_amount"] == "1250.40"
    assert row["stage"] == "new" and row["version"] == 1
    changed_body = {**body, "estimated_amount": "1250.41"}
    assert (
        client.post("/api/v1/crm/opportunities", json=changed_body, headers=headers).status_code
        == 400
    )
    patch = {"expected_version": 1, "stage": "won", "note": "Entrega acordada por teléfono"}
    changed = client.patch(
        f"/api/v1/crm/opportunities/{row['id']}", json=patch, headers={"Idempotency-Key": "crm-won"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["version"] == 2 and changed.json()["stage"] == "won"
    assert (
        client.patch(
            f"/api/v1/crm/opportunities/{row['id']}",
            json=patch,
            headers={"Idempotency-Key": "crm-won"},
        ).json()
        == changed.json()
    )
    assert (
        client.patch(
            f"/api/v1/crm/opportunities/{row['id']}",
            json=patch,
            headers={"Idempotency-Key": "crm-stale"},
        ).status_code
        == 409
    )
    assert (
        db.query(Opportunity).filter(Opportunity.tenant_id == UUID(account["tenant_id"])).count()
        == 1
    )
    assert db.query(Order).filter(Order.tenant_id == UUID(account["tenant_id"])).count() == 0
    audits = db.query(AuditLog).filter(AuditLog.action.like("crm.%")).all()
    assert len(audits) == 2
    assert "Ana" not in str([entry.changes for entry in audits])
    assert "Entrega" not in str([entry.changes for entry in audits])


def test_cross_tenant_and_branch_visibility_and_reference_validation(client):
    _, customer = setup(client)
    row = create(client, customer)
    assert row.status_code == 201, row.text
    branch = client.post(
        "/api/v1/branches", json={"name": "Norte"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    other_branch = {"X-Kova-Branch": branch["id"]}
    assert client.get("/api/v1/crm", headers=other_branch).json()["opportunities"] == []
    assert (
        client.patch(
            f"/api/v1/crm/opportunities/{row.json()['id']}",
            json={"expected_version": 1, "stage": "lost"},
            headers={**other_branch, "Idempotency-Key": str(uuid4())},
        ).status_code
        == 404
    )
    created = create(client, customer, branch=branch["id"])
    assert created.status_code == 201, created.text
    assert len(client.get("/api/v1/crm").json()["opportunities"]) == 1
    setup(client)
    assert client.get("/api/v1/crm").json()["opportunities"] == []
    assert create(client, customer).status_code == 404
    assert consent(client, customer).status_code == 404
    assert client.get(f"/api/v1/crm?customer_id={customer['id']}").status_code == 404


def test_consent_is_explicit_scoped_and_revocable_with_versioned_replay(client, db):
    account, customer = setup(client)
    tenant = UUID(account["tenant_id"])
    arguments = dict(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=UUID(customer["id"]),
        channel="whatsapp",
        purpose="transactional",
    )
    assert not service.contact_allowed(db, **arguments)
    created = consent(client, customer, key="grant")
    assert created.status_code == 200, created.text
    assert created.json()["enabled"] is True
    assert created.json()["contact_current"] is True
    assert created.json()["customer_name"] == "Ana García"
    assert consent(client, customer, key="grant").json() == created.json()
    assert service.contact_allowed(db, **arguments)
    assert not service.contact_allowed(db, **{**arguments, "purpose": "marketing"})
    assert not service.contact_allowed(db, **{**arguments, "channel": "email"})
    stale = consent(client, customer, enabled=False, expected_version=0)
    assert stale.status_code == 409
    withdrawn = consent(client, customer, enabled=False, expected_version=1, key="withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    assert not service.contact_allowed(db, **arguments)
    assert (
        consent(client, customer, enabled=False, expected_version=1, key="withdraw").json()
        == withdrawn.json()
    )
    assert db.query(ContactConsent).filter(ContactConsent.tenant_id == tenant).count() == 1
    audit = db.query(AuditLog).filter(AuditLog.action == "crm.consent.recorded").all()
    assert len(audit) == 2
    assert "5512345678" not in str([entry.changes for entry in audit])


def test_changing_contact_cannot_transfer_consent_to_new_address(client, db):
    account, customer = setup(client)
    assert consent(client, customer).status_code == 200
    row = db.get(Customer, UUID(customer["id"]))
    row.phone = "5599999999"
    db.commit()
    tenant = UUID(account["tenant_id"])
    args = dict(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=row.id,
        channel="whatsapp",
        purpose="transactional",
    )
    assert not service.contact_allowed(db, **args)
    overview = client.get("/api/v1/crm").json()
    assert overview["consents"][0]["enabled"] is True
    assert overview["consents"][0]["contact_current"] is False
    renewed = consent(client, customer, expected_version=1)
    assert renewed.status_code == 200, renewed.text
    assert service.contact_allowed(db, **args)
    row.is_active = False
    db.commit()
    assert not service.contact_allowed(db, **args)
    assert consent(client, customer, expected_version=2).status_code == 400
    assert consent(client, customer, enabled=False, expected_version=2).status_code == 200


def test_consent_requires_contact_and_does_not_cross_branch(client, db):
    account, customer = setup(client)
    row = db.get(Customer, UUID(customer["id"]))
    row.phone = None
    db.commit()
    assert consent(client, customer).status_code == 400
    assert consent(client, customer, enabled=False).status_code == 200
    assert consent(client, customer, channel="email").status_code == 200
    branch = client.post(
        "/api/v1/branches", json={"name": "Sur"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    assert (
        client.get("/api/v1/crm", headers={"X-Kova-Branch": branch["id"]}).json()["consents"] == []
    )
    tenant = UUID(account["tenant_id"])
    assert not service.contact_allowed(
        db,
        tenant_id=tenant,
        branch_id=UUID(branch["id"]),
        customer_id=row.id,
        channel="email",
        purpose="transactional",
    )


def test_roles_billing_and_idempotency_headers_are_required(client, db, monkeypatch):
    account, customer = setup(client)
    assert (
        client.post(
            "/api/v1/crm/opportunities", json={"customer_id": customer["id"], "title": "Nuevo"}
        ).status_code
        == 400
    )
    member = db.query(Membership).filter(Membership.tenant_id == UUID(account["tenant_id"])).one()
    for role in ("cashier", "staff"):
        member.role = role
        db.commit()
        assert client.get("/api/v1/crm").status_code == 403
        assert create(client, customer).status_code == 403
        assert consent(client, customer).status_code == 403
    member.role = "manager"
    db.commit()
    assert create(client, customer).status_code == 201
    monkeypatch.setattr(settings, "billing_trial_days", -1)
    assert client.get("/api/v1/crm").status_code == 402
    assert create(client, customer).status_code == 402


def test_assignee_must_be_active_member_in_scope(client, db):
    account, customer = setup(client)
    body = {"customer_id": customer["id"], "title": "Seguimiento", "assigned_user_id": str(uuid4())}
    response = client.post(
        "/api/v1/crm/opportunities", json=body, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 404
    body["assigned_user_id"] = account["user_id"]
    response = client.post(
        "/api/v1/crm/opportunities", json=body, headers={"Idempotency-Key": str(uuid4())}
    )
    assert response.status_code == 201, response.text
    branch = client.post(
        "/api/v1/branches", json={"name": "Otra"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    member = db.query(Membership).filter(Membership.tenant_id == UUID(account["tenant_id"])).one()
    member.allowed_branch_id = UUID(branch["id"])
    db.commit()
    # Assignment helper rejects a valid tenant member restricted to a different branch.
    db.info["kova_branch_id"] = UUID(account["tenant_id"])
    with pytest.raises(Exception) as failure:
        service._assignee(db, UUID(account["tenant_id"]), UUID(account["user_id"]))
    assert getattr(failure.value, "status_code", None) == 404


def test_filter_and_pagination_do_not_lose_customer_consents(client):
    _, customer = setup(client)
    assert create(client, customer).status_code == 201
    assert create(client, customer).status_code == 201
    assert consent(client, customer).status_code == 200
    assert consent(client, customer, channel="email").status_code == 200
    first = client.get("/api/v1/crm?limit=1").json()
    assert first["opportunities_has_more"] and first["consents_has_more"]
    second = client.get("/api/v1/crm?limit=1&offset=1").json()
    assert first["opportunities"][0]["id"] != second["opportunities"][0]["id"]
    selected = client.get(f"/api/v1/crm?customer_id={customer['id']}").json()
    assert len(selected["consents"]) == 2
    assert selected["capabilities"] == {"whatsapp": "not_connected", "email": "not_connected"}


@pytest.mark.parametrize(
    "body",
    [
        {"customer_id": str(uuid4()), "title": " "},
        {"customer_id": str(uuid4()), "title": "<script>bad</script>"},
        {"customer_id": str(uuid4()), "title": "Normal", "estimated_amount": "1.001"},
        {"customer_id": str(uuid4()), "title": "Normal", "tenant_id": str(uuid4())},
        {"customer_id": str(uuid4()), "title": "Normal", "due_at": "2026-10-19T12:00:00"},
    ],
)
def test_opportunity_input_validation(body):
    with pytest.raises(ValidationError):
        OpportunityCreate(**body)


def test_patch_nulls_and_consent_unknown_fields_rejected():
    for field in ("title", "stage", "estimated_amount"):
        with pytest.raises(ValidationError):
            OpportunityUpdate(expected_version=1, **{field: None})
    with pytest.raises(ValidationError):
        ConsentWrite(
            customer_id=uuid4(),
            channel="email",
            purpose="marketing",
            enabled=True,
            expected_version=0,
            proof="automatic",
        )


def test_crm_postgres_rls_forces_tenant_isolation_and_rejects_reassignment(
    owner_engine, kova_app_engine
):
    tenant_a, tenant_b, customer = uuid4(), uuid4(), uuid4()
    opportunity_id, consent_id = uuid4(), uuid4()
    with owner_engine.begin() as connection:
        for tenant in (tenant_a, tenant_b):
            connection.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES (:id,'CRM RLS',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
        connection.execute(
            text("INSERT INTO customers(id,tenant_id,name) VALUES (:id,:tenant,'Privado')"),
            {"id": customer, "tenant": tenant_a},
        )
        connection.execute(
            text("""INSERT INTO crm_opportunities
            (id,tenant_id,branch_id,customer_id,title,stage,estimated_amount,version,created_by_user_id,updated_by_user_id,created_at,updated_at)
            VALUES (:id,:tenant,:tenant,:customer,'Privado','new',1,1,:actor,:actor,now(),now())"""),
            {"id": opportunity_id, "tenant": tenant_a, "customer": customer, "actor": uuid4()},
        )
        connection.execute(
            text("""INSERT INTO customer_contact_consents
            (id,tenant_id,branch_id,customer_id,channel,purpose,enabled,source,version,recorded_by_user_id,updated_at)
            VALUES (:id,:tenant,:tenant,:customer,'email','marketing',false,'owner_recorded',1,:actor,now())"""),
            {"id": consent_id, "tenant": tenant_a, "customer": customer, "actor": uuid4()},
        )
    try:
        with kova_app_engine.connect() as connection:
            for table in ("crm_opportunities", "customer_contact_consents"):
                assert connection.execute(text(f"SELECT id FROM {table}")).all() == []
            connection.execute(
                text("SELECT set_config('app.tenant_id', :id, true)"), {"id": str(tenant_b)}
            )
            for table in ("crm_opportunities", "customer_contact_consents"):
                assert connection.execute(text(f"SELECT id FROM {table}")).all() == []
            connection.rollback()
            connection.execute(
                text("SELECT set_config('app.tenant_id', :id, true)"), {"id": str(tenant_a)}
            )
            assert (
                connection.execute(text("SELECT id FROM crm_opportunities")).scalar_one()
                == opportunity_id
            )
            assert (
                connection.execute(text("SELECT id FROM customer_contact_consents")).scalar_one()
                == consent_id
            )
            with pytest.raises(DBAPIError):
                connection.execute(
                    text("UPDATE customer_contact_consents SET tenant_id=:tenant WHERE id=:id"),
                    {"tenant": tenant_b, "id": consent_id},
                )
            connection.rollback()
    finally:
        with owner_engine.begin() as connection:
            connection.execute(
                text("DELETE FROM customer_contact_consents WHERE tenant_id=:id"), {"id": tenant_a}
            )
            connection.execute(
                text("DELETE FROM crm_opportunities WHERE tenant_id=:id"), {"id": tenant_a}
            )
            connection.execute(
                text("DELETE FROM tenants WHERE id IN (:a,:b)"), {"a": tenant_a, "b": tenant_b}
            )

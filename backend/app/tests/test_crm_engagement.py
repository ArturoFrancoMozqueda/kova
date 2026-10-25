from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.crm.engagement_models import CatalogRequest, FollowupTask
from app.crm.models import ContactConsent, Opportunity
from app.orders.models import Order
from app.tests.test_customer_orders import _product, _signup_login
from app.tests.test_storefront import _save, _seed_legacy_link_replacement

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _key():
    return {"Idempotency-Key": str(uuid4())}


def _customer(client):
    response = client.post(
        "/api/v1/customers", headers=_key(), json={"name": "Cliente elegido", "phone": "5512345678"}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _public_setup(client):
    tenant_id = _signup_login(client, prefix="capture")
    product = _product(client)
    saved = _save(client, [product]).json()
    url = saved["share_path"].replace("/catalogo/", "/api/v1/public/catalog/") + "/requests"
    body = {
        "submission_id": str(uuid4()),
        "name": "Persona interesada",
        "contact": "5512345678",
        "message": "Quiero información",
        "product_ids": [product["id"]],
    }
    return tenant_id, product, saved, url, body


def test_public_request_is_minimal_replay_safe_and_converts_only_explicit_customer(client, db):
    tenant, _, _, url, body = _public_setup(client)
    first = client.post(url, json=body)
    assert first.status_code == 201, first.text
    assert set(first.json()) == {"receipt_id", "status"}
    assert client.post(url, json=body).json() == first.json()
    assert client.post(url, json={**body, "message": "Changed"}).status_code == 409
    assert db.query(ContactConsent).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Opportunity).filter_by(tenant_id=tenant).count() == 0
    listing = client.get("/api/v1/crm/requests").json()["requests"]
    assert len(listing) == 1 and listing[0]["message"] == body["message"]
    row = listing[0]
    assert (
        client.post(
            f"/api/v1/crm/requests/{row['id']}/resolve",
            headers=_key(),
            json={"expected_version": 1, "status": "converted"},
        ).status_code
        == 422
    )
    customer = _customer(client)
    headers = _key()
    decision = {"expected_version": 1, "status": "converted", "customer_id": customer["id"]}
    converted = client.post(
        f"/api/v1/crm/requests/{row['id']}/resolve", headers=headers, json=decision
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()["opportunity_id"] is not None
    assert (
        client.post(
            f"/api/v1/crm/requests/{row['id']}/resolve", headers=headers, json=decision
        ).json()
        == converted.json()
    )
    assert (
        client.post(
            f"/api/v1/crm/requests/{row['id']}/resolve", headers=_key(), json=decision
        ).status_code
        == 409
    )
    assert db.query(Opportunity).filter_by(tenant_id=tenant).count() == 1
    assert db.query(ContactConsent).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 0


def test_public_intake_does_not_require_session_and_rejects_bad_origin_or_private_products(
    client, db
):
    tenant, _, saved, url, body = _public_setup(client)
    private = _product(client)
    client.cookies.clear()
    assert (
        client.post(url, json=body, headers={"Origin": "https://attacker.example"}).status_code
        == 403
    )
    assert client.post(url, json={**body, "product_ids": [private["id"]]}).status_code == 400
    assert client.post(url, json=body).status_code == 201
    assert client.get("/api/v1/crm/requests").status_code == 401
    assert db.query(CatalogRequest).filter_by(tenant_id=tenant).count() == 1
    assert (
        client.get(saved["share_path"].replace("/catalogo/", "/api/v1/public/catalog/")).status_code
        == 200
    )


def test_intake_rejects_revoked_link_billing_and_unsafe_content(client, db):
    tenant, _, _, url, body = _public_setup(client)
    assert client.post(url, json={**body, "name": "<script>x</script>"}).status_code == 422
    assert client.post(url, json={**body, "consent": True}).status_code == 422
    _seed_legacy_link_replacement(db, tenant)
    rotated = client.get("/api/v1/storefront/settings").json()
    assert client.post(url, json=body).status_code == 404
    new_url = (
        rotated["share_path"].replace("/catalogo/", "/api/v1/public/catalog/") + "/requests"
    )
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.post(new_url, json=body).status_code == 404


def _policy(client, enabled=True, version=0):
    return client.put(
        "/api/v1/crm/followups/policy",
        headers=_key(),
        json={
            "expected_version": version,
            "enabled": enabled,
            "review_delay_days": 2,
            "rebuy_delay_days": 30,
        },
    )


def _sale(db, tenant, customer, **extra):
    sale = Order(
        tenant_id=tenant,
        branch_id=tenant,
        customer_id=UUID(customer["id"]),
        subtotal_amount=Decimal("10.00"),
        total_amount=Decimal("10.00"),
        **extra,
    )
    db.add(sale)
    db.commit()
    return sale


def test_opt_in_followups_use_real_sales_and_are_deduped_independent_of_incident(client, db):
    tenant = _signup_login(client, prefix="followup")
    customer = _customer(client)
    historical = _sale(db, tenant, customer)
    assert client.post("/api/v1/crm/followups/process").json() == {"created": 0}
    policy = _policy(client)
    assert policy.status_code == 200, policy.text
    sale = _sale(db, tenant, customer)
    incident = client.post(
        "/api/v1/crm/followups",
        headers=_key(),
        json={
            "customer_id": customer["id"],
            "sale_order_id": str(sale.id),
            "title": "Entrega incompleta",
            "due_at": datetime.now(UTC).isoformat(),
        },
    )
    assert incident.status_code == 201, incident.text
    assert client.post("/api/v1/crm/followups/process").json() == {"created": 2}
    assert client.post("/api/v1/crm/followups/process").json() == {"created": 0}
    tasks = client.get("/api/v1/crm/followups").json()["tasks"]
    assert {t["kind"] for t in tasks} == {"review", "rebuy", "incident"}
    assert all(t["sale_order_id"] != str(historical.id) for t in tasks)
    assert "honesta" in next(t["title"] for t in tasks if t["kind"] == "review")
    assert db.query(ContactConsent).filter_by(tenant_id=tenant).count() == 0
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 2
    assert _policy(client, False, 1).status_code == 200
    rows = db.query(FollowupTask).filter_by(tenant_id=tenant).all()
    assert next(t for t in rows if t.kind == "incident").status == "pending"
    assert all(t.status == "dismissed" for t in rows if t.kind != "incident")


def test_followups_revalidate_billing_author_and_active_customer(client, db):
    tenant = _signup_login(client, prefix="followup-author")
    customer = _customer(client)
    assert _policy(client).status_code == 200
    _sale(db, tenant, customer)
    membership = db.query(Membership).filter_by(tenant_id=tenant).one()
    membership.role = "cashier"
    db.commit()
    from app.crm.engagement import process_due_followups

    assert process_due_followups(db, tenant) == 0
    membership.role = "owner"
    db.commit()
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert process_due_followups(db, tenant) == 0


def test_tasks_versioned_replay_isolated_and_incidents_do_not_reserve_or_pay(client, db):
    tenant = _signup_login(client, prefix="incident")
    customer = _customer(client)
    body = {
        "customer_id": customer["id"],
        "title": "Revisar entrega",
        "due_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
    }
    headers = _key()
    first = client.post("/api/v1/crm/followups", headers=headers, json=body)
    assert first.status_code == 201, first.text
    assert client.post("/api/v1/crm/followups", headers=headers, json=body).json() == first.json()
    task_id = first.json()["id"]
    patch = {"expected_version": 1, "status": "completed"}
    assert (
        client.patch(f"/api/v1/crm/followups/{task_id}", headers=_key(), json=patch).status_code
        == 200
    )
    assert (
        client.patch(f"/api/v1/crm/followups/{task_id}", headers=_key(), json=patch).status_code
        == 409
    )
    assert db.query(Order).filter_by(tenant_id=tenant).count() == 0
    _signup_login(client, prefix="incident-other")
    assert client.get("/api/v1/crm/followups").json()["tasks"] == []
    assert (
        client.patch(f"/api/v1/crm/followups/{task_id}", headers=_key(), json=patch).status_code
        == 404
    )


def test_engagement_tables_force_rls(client, db, kova_app_engine):
    tenant, _, _, url, body = _public_setup(client)
    assert client.post(url, json=body).status_code == 201
    for table in ("crm_catalog_requests", "crm_followup_policies", "crm_followup_tasks"):
        flags = db.execute(
            text("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:name"),
            {"name": table},
        ).one()
        assert tuple(flags) == (True, True)
        with kova_app_engine.connect() as conn:
            conn.execute(
                text("SELECT set_config('app.tenant_id',:tenant,true)"), {"tenant": str(uuid4())}
            )
            assert conn.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0


def test_requests_and_followups_are_branch_scoped_and_reject_foreign_customer(client, db):
    tenant, _, _, url, body = _public_setup(client)
    assert client.post(url, json=body).status_code == 201
    original = client.get("/api/v1/crm/requests").json()["requests"][0]
    branch = client.post("/api/v1/branches", headers=_key(), json={"name": "Otra sucursal"}).json()
    headers = {"X-Kova-Branch": branch["id"]}
    assert client.get("/api/v1/crm/requests", headers=headers).json()["requests"] == []
    assert (
        client.post(
            f"/api/v1/crm/requests/{original['id']}/resolve",
            headers={**headers, **_key()},
            json={"expected_version": 1, "status": "dismissed"},
        ).status_code
        == 404
    )
    _signup_login(client, prefix="foreign-customer")
    foreign = _customer(client)
    assert client.get("/api/v1/crm/requests").json()["requests"] == []
    assert (
        client.post(
            f"/api/v1/crm/requests/{original['id']}/resolve",
            headers=_key(),
            json={"expected_version": 1, "status": "converted", "customer_id": foreign["id"]},
        ).status_code
        == 404
    )
    assert db.query(CatalogRequest).filter_by(tenant_id=tenant).count() == 1


def test_public_requests_never_return_prior_private_resolution(client):
    _, _, _, url, body = _public_setup(client)
    receipt = client.post(url, json=body).json()
    customer = _customer(client)
    assert (
        client.post(
            f"/api/v1/crm/requests/{receipt['receipt_id']}/resolve",
            headers=_key(),
            json={"expected_version": 1, "status": "converted", "customer_id": customer["id"]},
        ).status_code
        == 200
    )
    client.cookies.clear()
    replay = client.post(url, json=body)
    assert replay.status_code == 201
    assert replay.json() == receipt
    assert customer["id"] not in replay.text
    assert "opportunity" not in replay.text


def test_followup_scan_advances_in_bounded_batches_and_skips_voided_sales(client, db):
    from app.crm.engagement import process_due_followups

    tenant = _signup_login(client, prefix="followup-batch")
    customer = _customer(client)
    assert _policy(client).status_code == 200
    _sale(db, tenant, customer)
    _sale(db, tenant, customer)
    _sale(db, tenant, customer, status="voided")
    assert process_due_followups(db, tenant, limit=1) == 2
    assert process_due_followups(db, tenant, limit=1) == 2
    assert process_due_followups(db, tenant, limit=1) == 0
    assert db.query(FollowupTask).filter_by(tenant_id=tenant).count() == 4


def test_rls_runtime_reads_own_intake_rejects_foreign_insert_and_immutable_update(
    client, db, kova_app_engine
):
    from sqlalchemy.exc import DBAPIError

    from app.db import set_tenant_context

    tenant, _, _, url, body = _public_setup(client)
    assert client.post(url, json=body).status_code == 201
    original = db.query(CatalogRequest).filter_by(tenant_id=tenant).one()
    db.execute(text("SET LOCAL ROLE kova_app"))
    set_tenant_context(db, tenant)
    assert db.query(CatalogRequest).filter_by(tenant_id=tenant).count() == 1
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text("UPDATE crm_catalog_requests SET contact='changed' WHERE id=:id"),
            {"id": original.id},
        )
    foreign = uuid4()
    set_tenant_context(db, foreign)
    assert db.query(CatalogRequest).count() == 0
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO crm_catalog_requests (id,tenant_id,branch_id,catalog_id,submission_id,request_hash,name,contact,message,product_ids,status,version,created_at) VALUES (:id,:tenant,:branch,:catalog,:submission,:hash,'Name','Contact','Message','[]','new',1,now())"
            ),
            {
                "id": uuid4(),
                "tenant": tenant,
                "branch": tenant,
                "catalog": original.catalog_id,
                "submission": uuid4(),
                "hash": "a" * 64,
            },
        )
    db.execute(text("RESET ROLE"))


def test_followup_excludes_refunded_sale_and_inactive_customer(client, db):
    from app.customers.models import Customer
    from app.orders.models import Refund

    tenant = _signup_login(client, prefix="followup-refund")
    customer = _customer(client)
    assert _policy(client).status_code == 200
    refunded = _sale(db, tenant, customer)
    db.add(
        Refund(
            tenant_id=tenant,
            branch_id=tenant,
            order_id=refunded.id,
            reason="customer_request",
            refunded_amount=Decimal("1.00"),
        )
    )
    db.commit()
    assert client.post("/api/v1/crm/followups/process").json() == {"created": 0}
    _sale(db, tenant, customer)
    db.query(Customer).filter_by(tenant_id=tenant, id=customer["id"]).one().is_active = False
    db.commit()
    assert client.post("/api/v1/crm/followups/process").json() == {"created": 0}
    assert db.query(FollowupTask).filter_by(tenant_id=tenant).count() == 0


def test_followup_worker_alone_processes_branch_without_automation_rule(client, db, monkeypatch):
    from contextlib import contextmanager

    from app.automations import worker
    from app.branches.scope import bind_branch

    tenant = _signup_login(client, prefix="followup-worker")
    customer = _customer(client)
    branch = client.post("/api/v1/branches", headers=_key(), json={"name": "Seguimiento"}).json()
    policy = client.put(
        "/api/v1/crm/followups/policy",
        headers={**_key(), "X-Kova-Branch": branch["id"]},
        json={
            "expected_version": 0,
            "enabled": True,
            "review_delay_days": 2,
            "rebuy_delay_days": 30,
        },
    )
    assert policy.status_code == 200, policy.text
    branch_id = UUID(branch["id"])
    bind_branch(db, tenant_id=tenant, branch_id=branch_id)
    db.add(
        Order(
            tenant_id=tenant,
            branch_id=branch_id,
            customer_id=UUID(customer["id"]),
            subtotal_amount=Decimal("10.00"),
            total_amount=Decimal("10.00"),
        )
    )
    db.commit()
    db.info.pop("kova_branch_id", None)

    @contextmanager
    def session():
        yield db

    monkeypatch.setattr(worker, "SessionLocal", session)
    assert worker.process_tenant(tenant) == 2
    assert db.query(FollowupTask).filter_by(tenant_id=tenant, branch_id=branch_id).count() == 2

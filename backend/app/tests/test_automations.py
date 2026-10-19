from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.auth.models import Membership
from app.automations.models import AutomationRun, BusinessEvent
from app.automations.service import process_pending, record_event
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.catalog.models import Product
from app.db import set_tenant_context
from app.tests.test_customer_orders import (
    _confirm,
    _create,
    _enable_customer_orders,
    _product,
    _seed,
    _signup_login,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/automations"


def _rule(client, key="order_ready", enabled=True, version=0, branch=None):
    headers = {"X-Kova-Branch": branch} if branch else {}
    result = client.put(
        f"{BASE}/rules/{key}",
        json={"enabled": enabled, "expected_version": version},
        headers=headers,
    )
    return result


def _ready(client, db):
    tenant = _signup_login(client, prefix="automations")
    _enable_customer_orders(db, tenant)
    assert _rule(client).status_code == 200
    product = _product(client)
    _seed(client, product["id"], 10)
    created = _create(client, product["id"]).json()
    order = _confirm(client, created).json()
    for status in ("in_progress", "ready"):
        changed = client.post(
            f"/api/v1/customer-orders/{order['id']}/status",
            headers={"Idempotency-Key": str(uuid4())},
            json={"version": order["version"], "status": status},
        )
        assert changed.status_code == 200, changed.text
        order = changed.json()
    return tenant, order


def _event(db, tenant, order, *, event_type="customer_order.ready"):
    bind_branch(db, tenant_id=tenant)
    record_event(
        db,
        tenant_id=tenant,
        branch_id=tenant,
        entity_id=UUID(order["id"]),
        entity_version=order["version"],
        event_type=event_type,
    )
    db.commit()


def test_defaults_disabled_and_capabilities_are_honest(client):
    _signup_login(client, prefix="automation-defaults")
    result = client.get(BASE)
    assert result.status_code == 200, result.text
    assert len(result.json()["rules"]) == 4
    assert all(not rule["enabled"] and rule["version"] == 0 for rule in result.json()["rules"])
    assert result.json()["runs"] == []
    assert result.json()["capabilities"] == {
        "internal_tasks": True,
        "external_messaging": False,
        "financial_actions": False,
    }
    assert client.post(f"{BASE}/process").json() == {
        "processed": 0,
        "created": 0,
        "suppressed": 0,
    }


def test_event_replay_and_resolution_do_not_duplicate_effect(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    _event(db, tenant, order)
    assert client.post(f"{BASE}/process").status_code == 200
    assert client.post(f"{BASE}/process").json()["created"] == 0
    overview = client.get(BASE).json()
    assert len(overview["runs"]) == 1
    task = overview["runs"][0]
    assert task["entity_id"] == order["id"] and task["status"] == "pending"
    payload = {"expected_version": task["version"], "status": "completed"}
    resolved = client.post(f"{BASE}/runs/{task['id']}/resolve", json=payload)
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "completed"
    assert client.post(f"{BASE}/runs/{task['id']}/resolve", json=payload).json() == resolved.json()
    assert (
        db.query(BusinessEvent)
        .filter_by(tenant_id=tenant, event_type="customer_order.ready")
        .count()
        == 1
    )
    assert db.query(AutomationRun).filter_by(tenant_id=tenant).count() == 1


def test_pause_suppresses_and_versions_prevent_stale_mutation(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    client.post(f"{BASE}/process")
    task = client.get(BASE).json()["runs"][0]
    paused = _rule(client, enabled=False, version=1)
    assert paused.status_code == 200 and paused.json()["version"] == 2
    assert client.get(BASE).json()["runs"][0]["status"] == "suppressed"
    assert _rule(client, enabled=True, version=1).status_code == 409
    assert (
        client.post(
            f"{BASE}/runs/{task['id']}/resolve",
            json={"expected_version": 1, "status": "completed"},
        ).status_code
        == 409
    )
    assert _rule(client, enabled=True, version=2).status_code == 200
    assert client.post(f"{BASE}/process").json()["created"] == 0


def test_cancelled_or_changed_order_cannot_complete_pending_task(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    client.post(f"{BASE}/process")
    task = client.get(BASE).json()["runs"][0]
    cancelled = client.post(
        f"/api/v1/customer-orders/{order['id']}/cancel",
        headers={"Idempotency-Key": str(uuid4())},
        json={"version": order["version"], "reason": "customer_request"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (
        client.post(
            f"{BASE}/runs/{task['id']}/resolve",
            json={"expected_version": 1, "status": "completed"},
        ).status_code
        == 409
    )
    client.post(f"{BASE}/process")
    assert client.get(BASE).json()["runs"][0]["status"] == "suppressed"


def test_rule_authorization_revoked_before_worker_processing(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    # An owner deactivated by normal account administration cannot authorize
    # work indefinitely; this test invokes the internal worker service directly.
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    member.is_active = False
    bind_branch(db, tenant_id=tenant)
    db.flush()
    result = process_pending(db, tenant_id=tenant)
    db.flush()
    assert result["created"] == 0
    assert not db.query(AutomationRun).filter_by(tenant_id=tenant, status="pending").count()


def test_branch_and_tenant_isolation_and_cashier_denied(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    client.post(f"{BASE}/process")
    task = client.get(BASE).json()["runs"][0]
    branch = client.post(
        "/api/v1/branches",
        json={"name": "Sucursal alterna"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()["id"]
    assert client.get(BASE, headers={"X-Kova-Branch": branch}).json()["runs"] == []
    denied = client.post(
        f"{BASE}/runs/{task['id']}/resolve",
        headers={"X-Kova-Branch": branch},
        json={"expected_version": 1, "status": "completed"},
    )
    assert denied.status_code == 404
    other_tenant = _signup_login(client, prefix="automation-other")
    assert client.get(BASE).json()["runs"] == []
    assert (
        client.post(
            f"{BASE}/runs/{task['id']}/resolve",
            json={"expected_version": 1, "status": "completed"},
        ).status_code
        == 404
    )
    member = db.query(Membership).filter_by(tenant_id=other_tenant).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE).status_code == 403
    assert _rule(client).status_code == 403
    assert client.post(f"{BASE}/process").status_code == 403


def test_billing_revoked_blocks_api_and_worker(client, db):
    tenant, order = _ready(client, db)
    _event(db, tenant, order)
    db.add(Subscription(tenant_id=tenant, status="canceled"))
    db.commit()
    assert client.get(BASE).status_code == 402
    bind_branch(db, tenant_id=tenant)
    assert process_pending(db, tenant_id=tenant) == {
        "processed": 0,
        "created": 0,
        "suppressed": 0,
    }


def test_event_rollback_does_not_leave_durable_work(client, db):
    tenant = _signup_login(client, prefix="automation-rollback")
    _rule(client)
    bind_branch(db, tenant_id=tenant)
    event_id = uuid4()
    with db.begin_nested() as savepoint:
        record_event(
            db,
            tenant_id=tenant,
            branch_id=tenant,
            entity_id=event_id,
            entity_version=1,
            event_type="customer_order.ready",
        )
        assert db.query(BusinessEvent).filter_by(entity_id=event_id).count() == 1
        savepoint.rollback()
    assert db.query(BusinessEvent).filter_by(entity_id=event_id).count() == 0
    assert client.post(f"{BASE}/process").json()["created"] == 0


def test_restock_task_revalidates_stock_and_ignores_missing_threshold(client, db):
    tenant = _signup_login(client, prefix="automation-stock")
    assert _rule(client, key="restock_review").status_code == 200
    product = _product(client)
    bind_branch(db, tenant_id=tenant)
    record_event(
        db,
        tenant_id=tenant,
        branch_id=tenant,
        entity_id=UUID(product["id"]),
        entity_version=1,
        event_type="inventory.restock_review",
    )
    assert process_pending(db, tenant_id=tenant)["created"] == 0
    stored = db.get(Product, UUID(product["id"]))
    stored.low_stock_threshold = 2
    db.flush()
    record_event(
        db,
        tenant_id=tenant,
        branch_id=tenant,
        entity_id=stored.id,
        entity_version=2,
        event_type="inventory.restock_review",
    )
    assert process_pending(db, tenant_id=tenant)["created"] == 1
    db.commit()
    _seed(client, product["id"], 10)
    bind_branch(db, tenant_id=tenant)
    assert process_pending(db, tenant_id=tenant)["suppressed"] == 1


def test_automation_tables_force_rls_and_protect_identity(db, kova_app_engine):
    for table in ("automation_rules", "business_events", "automation_runs"):
        flags = db.execute(
            text("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:table"),
            {"table": table},
        ).one()
        assert flags.relrowsecurity and flags.relforcerowsecurity
        policy = db.execute(
            text(
                "SELECT qual,with_check FROM pg_policies WHERE tablename=:table "
                "AND policyname='tenant_isolation'"
            ),
            {"table": table},
        ).one()
        assert "app.tenant_id" in policy.qual and "app.tenant_id" in policy.with_check
        for privilege in ("DELETE", "TRUNCATE"):
            assert not db.execute(
                text("SELECT has_table_privilege('kova_app',:table,:privilege)"),
                {"table": table, "privilege": privilege},
            ).scalar()
        assert not db.execute(
            text("SELECT has_column_privilege('kova_app',:table,'tenant_id','UPDATE')"),
            {"table": table},
        ).scalar()
    assert not db.execute(
        text("SELECT has_column_privilege('kova_app','business_events','entity_id','UPDATE')")
    ).scalar()


def test_real_domain_hooks_create_ready_then_fulfilled_tasks(client, db):
    tenant, order = _ready(client, db)
    # No record_event/process calls here: the ordinary order transition is the
    # complete trigger, and commits the event/task alongside the new status.
    initial = client.get(BASE).json()["runs"]
    assert len(initial) == 1 and initial[0]["template_key"] == "order_ready"
    assert _rule(client, key="order_fulfilled").status_code == 200
    checkout = client.post(
        f"/api/v1/customer-orders/{order['id']}/checkout",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "version": order["version"],
            "payments": [{"method": "bank_transfer", "amount": "50.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
    paid = checkout.json()["customer_order"]
    fulfilled = client.post(
        f"/api/v1/customer-orders/{paid['id']}/status",
        headers={"Idempotency-Key": str(uuid4())},
        json={"version": paid["version"], "status": "fulfilled"},
    )
    assert fulfilled.status_code == 200, fulfilled.text
    runs = client.get(BASE).json()["runs"]
    assert len(runs) == 2
    by_key = {run["template_key"]: run for run in runs}
    assert by_key["order_ready"]["status"] == "suppressed"
    assert by_key["order_fulfilled"]["status"] == "pending"
    assert db.query(BusinessEvent).filter_by(tenant_id=tenant).count() >= 2


def test_real_runtime_rls_blocks_foreign_events_and_immutable_identity(
    client,
    db,
    kova_app_engine,
):
    tenants = [_signup_login(client, prefix=f"automation-rls-{index}") for index in range(2)]
    identifiers = [uuid4(), uuid4()]
    for tenant, entity in zip(tenants, identifiers, strict=True):
        bind_branch(db, tenant_id=tenant)
        record_event(
            db,
            tenant_id=tenant,
            branch_id=tenant,
            entity_id=entity,
            entity_version=1,
            event_type="customer_order.ready",
        )
    db.flush()
    # Same connection keeps seed rows visible without committing the enclosing
    # test transaction; SET LOCAL ROLE still enforces the real runtime policy.
    set_tenant_context(db, tenants[0])
    db.execute(text("SET LOCAL ROLE kova_app"))
    counts = db.execute(
        text("SELECT tenant_id,count(*) FROM business_events GROUP BY tenant_id")
    ).all()
    assert counts == [(tenants[0], 1)]
    assert (
        db.execute(
            text("UPDATE business_events SET processed_at=now() WHERE tenant_id=:tenant"),
            {"tenant": tenants[1]},
        ).rowcount
        == 0
    )
    with pytest.raises(DBAPIError) as denied:
        with db.begin_nested():
            db.execute(
                text("UPDATE business_events SET entity_id=:entity WHERE tenant_id=:tenant"),
                {"entity": uuid4(), "tenant": tenants[0]},
            )
    assert denied.value.orig.sqlstate == "42501"
    with pytest.raises(DBAPIError) as denied_insert:
        with db.begin_nested():
            db.execute(
                text(
                    "INSERT INTO business_events "
                    "(id,tenant_id,branch_id,event_type,entity_id,entity_version,created_at) "
                    "VALUES (:id,:tenant,:tenant,'customer_order.ready',:entity,2,now())"
                ),
                {"id": uuid4(), "tenant": tenants[1], "entity": uuid4()},
            )
    assert denied_insert.value.orig.sqlstate == "42501"


def test_stock_scan_creates_deduplicated_tasks_and_sees_reservation_edits(client, db):
    tenant, order = _ready(client, db)
    assert _rule(client, key="restock_review").status_code == 200
    item = order["items"][0]
    threshold = client.patch(
        f"/api/v1/inventory/products/{item['product_id']}/low-stock-threshold",
        headers={"Idempotency-Key": str(uuid4())},
        json={"low_stock_threshold": 7},
    )
    assert threshold.status_code == 200, threshold.text
    # Ten physical units minus two reserved units is above this threshold.
    assert client.post(f"{BASE}/process").json()["created"] == 0
    changed = client.patch(
        f"/api/v1/customer-orders/{order['id']}",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "version": order["version"],
            "items": [
                {
                    "id": item["id"],
                    "product_id": item["product_id"],
                    "quantity": 3,
                }
            ],
        },
    )
    assert changed.status_code == 200, changed.text
    # Editing the existing reservation row must still produce a fresh identity.
    result = client.post(f"{BASE}/process")
    assert result.status_code == 200, result.text
    restock = [
        run for run in client.get(BASE).json()["runs"] if run["template_key"] == "restock_review"
    ]
    assert len(restock) == 1 and restock[0]["status"] == "pending"
    assert restock[0]["entity_version"] > 2**31
    assert restock[0]["entity_version"] < 2**53
    assert client.post(f"{BASE}/process").json()["created"] == 0
    task = restock[0]
    assert (
        client.post(
            f"{BASE}/runs/{task['id']}/resolve",
            json={"expected_version": task["version"], "status": "completed"},
        ).status_code
        == 200
    )
    # A later threshold edit is a real change even with no new movement/reservation.
    threshold = client.patch(
        f"/api/v1/inventory/products/{item['product_id']}/low-stock-threshold",
        headers={"Idempotency-Key": str(uuid4())},
        json={"low_stock_threshold": 8},
    )
    assert threshold.status_code == 200
    assert client.post(f"{BASE}/process").json()["created"] == 1
    _seed(client, item["product_id"], 10)
    assert client.post(f"{BASE}/process").json()["suppressed"] == 1


def test_private_worker_processes_configured_branches_without_assistant_cohort(
    client,
    db,
    monkeypatch,
):
    from sqlalchemy.orm import Session

    from app.automations import worker

    tenant, order = _ready(client, db)
    product_id = order["items"][0]["product_id"]
    branch_response = client.post(
        "/api/v1/branches",
        json={"name": "Sucursal para automatizar"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert branch_response.status_code == 201, branch_response.text
    branch = branch_response.json()["id"]
    assert _rule(client, key="restock_review", branch=branch).status_code == 200
    threshold = client.patch(
        f"/api/v1/inventory/products/{product_id}/low-stock-threshold",
        headers={"Idempotency-Key": str(uuid4())},
        json={"low_stock_threshold": 1},
    )
    assert threshold.status_code == 200
    connection = db.get_bind()
    monkeypatch.setattr(
        worker,
        "SessionLocal",
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint"),
    )
    assert worker.process_tenant(tenant) == 1
    db.expire_all()
    # The original branch has physical stock, while the new branch has none.
    overview = client.get(BASE, headers={"X-Kova-Branch": branch}).json()
    assert len(overview["runs"]) == 1
    assert overview["runs"][0]["template_key"] == "restock_review"
    assert worker.process_tenant(tenant) == 0


def test_disabling_orders_module_revokes_pending_order_work(client, db):
    from app.tenants.models import Tenant

    tenant, _ = _ready(client, db)
    stored = db.get(Tenant, tenant)
    stored.feature_overrides = {**stored.feature_overrides, "customer_orders": False}
    db.commit()
    result = client.post(f"{BASE}/process")
    assert result.status_code == 200, result.text
    assert result.json()["suppressed"] == 1
    assert client.get(BASE).json()["runs"][0]["status"] == "suppressed"

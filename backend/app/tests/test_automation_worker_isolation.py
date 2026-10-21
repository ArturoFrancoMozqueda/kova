"""A failing branch cannot starve independent work or consume its source event."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.automations import worker
from app.automations.models import AutomationRun, BusinessEvent
from app.automations.service import record_event
from app.branches.scope import active_branch_id
from app.tests.test_automations import _rule
from app.tests.test_customer_orders import _product, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_failed_first_branch_retains_event_while_other_branch_commits_and_retry_is_safe(
    client, db, monkeypatch, caplog
):
    tenant = _signup_login(client, prefix="automation-branch-recovery")
    branch = client.post(
        "/api/v1/branches", json={"name": "Trabajo independiente"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert branch.status_code == 201, branch.text
    first, second = sorted([tenant, UUID(branch.json()["id"])])
    product = _product(client)
    threshold = client.patch(
        f"/api/v1/inventory/products/{product['id']}/low-stock-threshold",
        headers={"Idempotency-Key": str(uuid4())}, json={"low_stock_threshold": 1},
    )
    assert threshold.status_code == 200, threshold.text
    for branch_id in (first, second):
        assert _rule(client, key="restock_review", branch=str(branch_id)).status_code == 200
    record_event(
        db, tenant_id=tenant, branch_id=first, entity_id=uuid4(), entity_version=1,
        event_type="customer_order.cancelled",
    )
    db.commit()
    event_id = db.query(BusinessEvent.id).filter_by(tenant_id=tenant).scalar()
    connection = db.get_bind()
    monkeypatch.setattr(
        worker, "SessionLocal",
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint"),
    )
    original = worker.process_pending
    visited = []

    def process(session, *, tenant_id, branch_id, limit):
        visited.append(branch_id)
        assert tenant_id == tenant
        assert active_branch_id(session, tenant) == branch_id
        assert session.execute(text("SELECT current_setting('app.tenant_id')")).scalar() == str(tenant)
        result = original(session, tenant_id=tenant_id, branch_id=branch_id, limit=limit)
        if branch_id == first:
            # Real SQL transaction failure after derived work: the branch's
            # source event and effects must both roll back before continuing.
            session.execute(text("SELECT 1 / 0"))
        return result

    monkeypatch.setattr(worker, "process_pending", process)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="Automation branch iteration failed"):
            worker.process_tenant(tenant)
        db.expire_all()
        assert db.get(BusinessEvent, event_id).processed_at is None
        runs = db.query(AutomationRun).filter_by(tenant_id=tenant).all()
        assert len(runs) == 1 and runs[0].branch_id == second
    assert visited == [first, second, first, second]
    assert str(tenant) not in caplog.text
    assert "division by zero" not in caplog.text

    monkeypatch.setattr(worker, "process_pending", original)
    assert worker.process_tenant(tenant) > 0
    db.expire_all()
    assert db.get(BusinessEvent, event_id).processed_at is not None
    assert db.query(AutomationRun).filter_by(tenant_id=tenant).count() == 2
    assert worker.process_tenant(tenant) == 0

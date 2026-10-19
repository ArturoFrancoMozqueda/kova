from sqlalchemy import text

from app.automations.models import BusinessEvent
from app.tests.test_automations import _ready


def test_task_processing_failure_does_not_undo_ready_order_and_event(client, db, monkeypatch):
    from app.automations import service

    def fail_processing(db, **_kwargs):
        db.execute(text("SELECT 1 / 0"))

    with monkeypatch.context() as patch:
        patch.setattr(service, "process_pending", fail_processing)
        tenant, order = _ready(client, db)
    assert order["status"] == "ready"
    assert client.get(f"/api/v1/customer-orders/{order['id']}").json()["status"] == "ready"
    event = db.query(BusinessEvent).filter_by(tenant_id=tenant).one()
    assert event.processed_at is None
    result = client.post("/api/v1/automations/process")
    assert result.status_code == 200, result.text
    assert result.json()["created"] == 1

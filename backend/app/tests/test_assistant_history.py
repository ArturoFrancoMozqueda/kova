from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.assistant import direct, generation, provider, tools
from app.branches.scope import bind_branch
from app.config import settings
from app.orders.models import Order
from app.tests.test_assistant import signup
from app.tests.test_assistant_groq import running_job


@pytest.fixture
def enabled_client(client, db, monkeypatch):
    tenant, email = signup(client)
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(tenant))
    return client, db, tenant, email


@pytest.mark.parametrize("question", [
    "Cual ha sido mi producto mejor vendido en todo mi historico?",
    "¿Cuál es mi producto más vendido en todo mi historial?",
    "Qué productos se venden más históricamente",
])
def test_explicit_history_does_not_match_today(question):
    assert direct.match(question) == ("get_top_products", "historico", None)
    assert direct.match("Qué productos se venden más hoy") == ("get_top_products", "hoy", None)


def test_historical_read_rejects_conflicting_dates(enabled_client):
    _, db, tenant, _ = enabled_client
    with pytest.raises(HTTPException) as error:
        tools.call(db, tenant, tenant, "get_top_products",
                   {"all_history": True, "start_date": "2026-10-08"})
    assert error.value.status_code == 422


def test_historical_answer_uses_old_sales_refunds_and_only_authorized_branch(
    enabled_client, monkeypatch,
):
    client, db, tenant, _ = enabled_client

    def post(path, body, branch=None):
        headers = {"Idempotency-Key": str(uuid4())}
        if branch:
            headers["X-Kova-Branch"] = branch
        response = client.post(path, json=body, headers=headers)
        assert response.status_code == 201, response.text
        return response.json()

    post("/api/v1/shifts", {"opening_cash_amount": "100.00"})
    product = post("/api/v1/catalog/products", {"name": "Pan histórico", "price_amount": "12.00"})
    sale = post("/api/v1/orders", {
        "items": [{"product_id": product["id"], "quantity": 3}],
        "payments": [{"method": "cash", "amount": "36.00", "amount_tendered": "36.00"}],
    })
    post(f"/api/v1/orders/{sale['id']}/refunds", {
        "items": [{"order_item_id": sale["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return", "refund_payment_method": "cash",
    })
    old = db.get(Order, UUID(sale["id"]))
    old.occurred_at = datetime.now(UTC) - timedelta(days=400)
    db.commit()

    branch = post("/api/v1/branches", {"name": "Otra sucursal"})["id"]
    post("/api/v1/shifts", {"opening_cash_amount": "100.00"}, branch)
    post("/api/v1/orders", {
        "items": [{"product_id": product["id"], "quantity": 100}],
        "payments": [{"method": "cash", "amount": "1200.00", "amount_tendered": "1200.00"}],
    }, branch)
    bind_branch(db, tenant_id=tenant)
    assert tools.call(db, tenant, tenant, "get_top_products", {})["products"] == []

    ctx, job = running_job(db, tenant, "Cual ha sido mi producto mejor vendido en todo mi historico?")
    monkeypatch.setattr(provider, "generate", lambda *a, **kw: pytest.fail("No paid inference"))
    generation.run(db, ctx, job)
    result = job.data["cards"][0]["data"]
    assert result["all_history"] is True
    assert result["products"] == [{"product_id": product["id"], "product_name": "Pan histórico",
                                  "quantity_sold": 2, "gross_sales": "24.00"}]
    assert "todo el histórico" in job.data["answer"]
    assert job.data["proposal_id"] is None
    reopened = client.get(f"/api/v1/assistant/conversations/{job.parent_id}")
    assert reopened.status_code == 200, reopened.text
    answer = next(message["data"] for message in reopened.json()["messages"]
                  if message["data"].get("run_id") == str(job.id))
    assert answer["cards"] == job.data["cards"]
    assert answer["sources"] == job.data["sources"]
    assert answer["generated_at"] == job.data["generated_at"]
    denied = client.get(f"/api/v1/assistant/conversations/{job.parent_id}",
                        headers={"X-Kova-Branch": branch})
    assert denied.status_code == 409

    # Even an explicit tenant ID cannot read a different business's history.
    assert tools.call(db, uuid4(), ctx[0].id, "get_top_products", {"all_history": True})["products"] == []

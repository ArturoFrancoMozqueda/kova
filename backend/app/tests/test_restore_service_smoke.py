"""Exercise the isolated restore probe against the real auth/export API contract."""
import asyncio
import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest

from app.config import settings
from app.main import app

SPEC = importlib.util.spec_from_file_location(
    "restore_service_smoke", Path(__file__).resolve().parents[3] / "scripts/restore_service_smoke.py"
)
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


@pytest.fixture
def exported_tenant(client, monkeypatch):
    password = "Restore-probe-only-2026!"
    first = None
    for index in range(2):
        email = f"restore-probe-{index}@example.com"
        signup = client.post("/api/v1/auth/signup", json={
            "email": email, "password": password, "tenant_name": f"Restauración QA {index}",
            "accepted_terms": True,
        })
        assert signup.status_code == 201
        verify = client.post("/api/v1/auth/verify", json={"token": signup.json()["dev_verification_token"]})
        assert verify.status_code == 200
        assert client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code == 200
        assert client.post("/api/v1/shifts", json={"opening_cash_amount": "0"}, headers={"Idempotency-Key": uuid4().hex}).status_code == 201
        product = client.post("/api/v1/catalog/products", json={"name": "Producto QA", "price_amount": "20"}, headers={"Idempotency-Key": uuid4().hex})
        assert product.status_code == 201
        for _ in range(index+1):
            order = client.post("/api/v1/orders", json={
                "items": [{"product_id": product.json()["id"], "quantity": 1}],
                "payments": [{"method": "cash", "amount": "20", "amount_tendered": "20"}],
            }, headers={"Idempotency-Key": uuid4().hex})
            assert order.status_code == 201
        if index == 0:
            first = (email, password, signup.json()["tenant_id"])
        client.cookies.clear()
    monkeypatch.setattr(settings, "app_env", "ci")
    monkeypatch.setattr(settings, "frontend_url", "https://restore.invalid")
    return first


def test_probe_logs_in_with_secure_cookies_reads_one_tenant_and_revokes_session(exported_tenant):
    asyncio.run(SMOKE.check_api(app, *exported_tenant, {"orders": 1, "payments": 1, "products": 1}))


def test_probe_rejects_export_that_does_not_match_restored_sql_counts(exported_tenant):
    with pytest.raises(RuntimeError, match="Isolated restore application check failed"):
        asyncio.run(SMOKE.check_api(app, *exported_tenant, {"orders": 2, "payments": 1, "products": 1}))

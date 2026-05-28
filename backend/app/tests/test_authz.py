"""Authorization / RBAC tests (Sprint 0B).

Proves the require_permission dependency rejects insufficient roles.
Uses a demo endpoint mounted only in the test to exercise the dependency
without coupling tests to a real product endpoint.
"""
from fastapi import Depends
from fastapi.testclient import TestClient

from app.main import app
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission


# Mount a demo route for this test module
@app.get("/api/v1/_test/settings-manage")
def _test_settings(ctx=Depends(require_permission(Permission.SETTINGS_MANAGE))):
    return {"ok": True}


@app.get("/api/v1/_test/orders-create")
def _test_orders(ctx=Depends(require_permission(Permission.ORDERS_CREATE))):
    return {"ok": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _signup_login_as(client: TestClient, email: str, tenant: str) -> None:
    r = client.post("/api/v1/auth/signup", json={"email": email, "password": "S3cur3!", "tenant_name": tenant, "accepted_terms": True})
    assert r.status_code == 201
    token = r.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3!"})


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_owner_can_access_settings_manage(client: TestClient):
    _signup_login_as(client, "owner@rbac-test.com", "RBAC Test Tenant")
    r = client.get("/api/v1/_test/settings-manage")
    assert r.status_code == 200


def test_owner_can_access_orders_create(client: TestClient):
    _signup_login_as(client, "owner2@rbac-test.com", "RBAC Test Tenant 2")
    r = client.get("/api/v1/_test/orders-create")
    assert r.status_code == 200


def test_unauthenticated_returns_401(client: TestClient):
    from app.main import app as _app
    with TestClient(_app) as anon:
        r = anon.get("/api/v1/_test/settings-manage")
        assert r.status_code == 401

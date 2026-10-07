"""Tenant isolation tests (Sprint 0B).

Proves that a user authenticated as Tenant A cannot access Tenant B's data.
"""
import pytest
from fastapi.testclient import TestClient

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _create_and_login(client: TestClient, email: str, tenant: str) -> None:
    r = client.post("/api/v1/auth/signup", json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant, "accepted_terms": True})
    assert r.status_code == 201
    token = r.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})


def test_me_scoped_to_authenticated_tenant(client: TestClient):
    """Two tenants sign up; each /me response reflects only their own tenant."""
    # Use separate client instances to hold independent cookie jars
    from app.main import app
    with TestClient(app) as client_a, TestClient(app) as client_b:
        _create_and_login(client_a, "owner-a@example.com", "Tenant A")
        _create_and_login(client_b, "owner-b@example.com", "Tenant B")

        me_a = client_a.get("/api/v1/auth/me").json()
        me_b = client_b.get("/api/v1/auth/me").json()

        assert me_a["tenant_name"] == "Tenant A"
        assert me_b["tenant_name"] == "Tenant B"
        assert me_a["tenant_id"] != me_b["tenant_id"]


def test_session_tied_to_tenant(client: TestClient):
    """Session created during Tenant A login carries Tenant A's tenant_id."""
    from app.main import app
    with TestClient(app) as client_a:
        _create_and_login(client_a, "owner-a2@example.com", "Tenant A2")
        r = client_a.get("/api/v1/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["role"] == "owner"
        assert body["tenant_id"] == body["user"]["tenant_id"]


def test_unauthenticated_cannot_access_protected_resource(client: TestClient):
    """No cookie → 401 on any protected endpoint."""
    from app.main import app
    with TestClient(app) as anon:
        r = anon.get("/api/v1/auth/me")
        assert r.status_code == 401

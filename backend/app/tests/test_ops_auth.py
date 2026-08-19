"""Internal ops dashboard — allowlist auth tests.

The ops dashboard must be invisible to normal tenant users: only emails in
INTERNAL_ADMIN_EMAILS get in, regardless of tenant role, and ops requests must
never leave the RLS GUC (`app.tenant_id`) set because their queries are
cross-tenant by design.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.main import _validate_config, app

PASSWORD = "S3cur3pass!"


def _signup_login(client: TestClient, email: str, tenant: str) -> None:
    r = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": PASSWORD,
            "tenant_name": tenant,
            "accepted_terms": True,
        },
    )
    assert r.status_code == 201
    token = r.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    r = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200


def test_unauthenticated_returns_401(db):
    with TestClient(app) as anon:
        assert anon.get("/api/v1/internal/ops/me").status_code == 401
        assert anon.get("/api/v1/internal/ops/overview").status_code == 401


def test_owner_not_allowlisted_returns_403(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "someone-else@ops-test.com")
    _signup_login(client, "owner@ops-test.com", "Ops Tenant")
    r = client.get("/api/v1/internal/ops/me")
    assert r.status_code == 403


def test_empty_allowlist_denies_everyone(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "")
    _signup_login(client, "owner-empty@ops-test.com", "Ops Tenant Empty")
    assert client.get("/api/v1/internal/ops/me").status_code == 403


def test_allowlisted_admin_gets_access(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo@ops-test.com")
    _signup_login(client, "ceo@ops-test.com", "Ops HQ")
    r = client.get("/api/v1/internal/ops/me")
    assert r.status_code == 200
    assert r.json() == {"email": "ceo@ops-test.com", "is_internal_admin": True}


def test_allowlist_is_case_insensitive(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", " CEO2@Ops-Test.com , x@y.com ")
    _signup_login(client, "ceo2@ops-test.com", "Ops HQ 2")
    assert client.get("/api/v1/internal/ops/me").status_code == 200


def test_unverified_email_is_rejected_even_if_allowlisted(client, db, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo3@ops-test.com")
    _signup_login(client, "ceo3@ops-test.com", "Ops HQ 3")
    # Simulate the verified flag being revoked after login: the dependency must
    # re-check on every request, not trust that login once succeeded.
    db.execute(
        text("UPDATE users SET is_email_verified = false WHERE email = :email"),
        {"email": "ceo3@ops-test.com"},
    )
    assert client.get("/api/v1/internal/ops/me").status_code == 403


def test_overview_reports_db_health_and_not_configured_sources(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo4@ops-test.com")
    for field in (
        "sentry_api_token",
        "fly_api_token",
        "vercel_api_token",
        "uptimerobot_api_key",
    ):
        monkeypatch.setattr(settings, field, None)
    _signup_login(client, "ceo4@ops-test.com", "Ops HQ 4")

    r = client.get("/api/v1/internal/ops/overview")
    assert r.status_code == 200
    body = r.json()
    sources = body["health"]["sources"]
    assert sources["db"]["status"] == "ok"
    assert sources["db"]["latency_ms"] is not None
    for name in ("sentry", "fly", "vercel", "uptimerobot"):
        assert sources[name]["status"] == "not_configured"
    # not_configured sources never elevate the overall status.
    assert body["health"]["overall"] == "ok"
    assert body["environment"] == "local"
    assert set(body["growth"]) == {
        "users_created",
        "users_verified",
        "tenants_with_completed_sale",
        "paying_tenants",
    }
    assert all(isinstance(value, int) for value in body["growth"].values())


def test_ops_request_clears_rls_guc(client, db, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo5@ops-test.com")
    _signup_login(client, "ceo5@ops-test.com", "Ops HQ 5")

    # A tenant-scoped request sets the RLS GUC on the shared test transaction…
    r = client.get("/api/v1/auth/session")
    assert r.status_code == 200
    guc = db.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar()
    assert guc

    # …and any ops request must clear it so cross-tenant reads see everything.
    assert client.get("/api/v1/internal/ops/overview").status_code == 200
    guc = db.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar()
    assert guc in ("", None)


def test_validate_config_rejects_non_email_allowlist_entries(monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo@ops-test.com,not-an-email")
    with pytest.raises(RuntimeError, match="INTERNAL_ADMIN_EMAILS"):
        _validate_config()

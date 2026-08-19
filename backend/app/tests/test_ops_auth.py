"""Internal ops dashboard — allowlist auth tests.

The ops dashboard must be invisible to normal tenant users: only emails in
INTERNAL_ADMIN_EMAILS get in, regardless of tenant role, and ops requests must
never leave the RLS GUC (`app.tenant_id`) set because their queries are
cross-tenant by design.
"""
from uuid import uuid4

import pyotp
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.auth.models import User
from app.config import settings
from app.db import get_db, get_privileged_db
from app.main import _validate_config, _validate_internal_ops_config, app
from app.ops.dependencies import require_internal_admin, require_internal_founder

PASSWORD = "S3cur3pass!"


def _signup_login(
    client: TestClient,
    email: str,
    tenant: str,
    *,
    enroll_mfa: bool = True,
) -> None:
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
    if enroll_mfa and email.lower() in settings.internal_admin_email_set:
        setup = client.post(
            "/api/v1/internal/ops/mfa/setup",
            json={
                "password": PASSWORD,
                "enrollment_key": settings.internal_ops_mfa_enrollment_key.get_secret_value(),
            },
        )
        assert setup.status_code == 200
        code = pyotp.TOTP(setup.json()["secret"]).now()
        confirm = client.post(
            "/api/v1/internal/ops/mfa/confirm",
            json={
                "password": PASSWORD,
                "enrollment_key": settings.internal_ops_mfa_enrollment_key.get_secret_value(),
                "code": code,
            },
        )
        assert confirm.status_code == 200
        assert len(confirm.json()["recovery_codes"]) == 10


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


def test_admin_uuid_must_match_immutable_user(client, db, monkeypatch):
    email = "uuid-ceo@ops-test.com"
    monkeypatch.setattr(settings, "internal_admin_emails", email)
    _signup_login(client, email, "UUID HQ")
    actual_id = db.query(User.id).filter(User.email == email).scalar()

    monkeypatch.setattr(settings, "internal_admin_user_id", actual_id)
    assert client.get("/api/v1/internal/ops/me").status_code == 200

    monkeypatch.setattr(settings, "internal_admin_user_id", actual_id.__class__(int=0))
    assert client.get("/api/v1/internal/ops/me").status_code == 403


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


def test_nonlocal_ops_config_requires_one_email_and_uuid(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "staging")
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo@ops-test.com")
    monkeypatch.setattr(settings, "internal_admin_user_id", None)
    with pytest.raises(RuntimeError, match="requires exactly one"):
        _validate_internal_ops_config()


def test_nonlocal_ops_config_requires_separate_mfa_root(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "staging")
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo@ops-test.com")
    monkeypatch.setattr(settings, "internal_admin_user_id", uuid4())
    monkeypatch.setattr(settings, "internal_ops_mfa_root_key", None)
    with pytest.raises(RuntimeError, match="INTERNAL_OPS_MFA_ROOT_KEY"):
        _validate_internal_ops_config()

    monkeypatch.setattr(
        settings,
        "internal_ops_mfa_root_key",
        SecretStr("a-separate-production-mfa-root-key-with-enough-entropy"),
    )
    monkeypatch.setattr(
        settings,
        "internal_ops_mfa_enrollment_key",
        SecretStr("a-separate-production-enrollment-key-with-enough-entropy"),
    )
    _validate_internal_ops_config()


def test_nonlocal_ops_config_rejects_reused_security_keys(monkeypatch):
    shared = "do-not-reuse-this-production-secret-value"
    monkeypatch.setattr(settings, "app_env", "staging")
    monkeypatch.setattr(settings, "internal_admin_emails", "ceo@ops-test.com")
    monkeypatch.setattr(settings, "internal_admin_user_id", uuid4())
    monkeypatch.setattr(settings, "secret_key", shared)
    monkeypatch.setattr(settings, "internal_ops_mfa_root_key", SecretStr(shared))
    monkeypatch.setattr(
        settings,
        "internal_ops_mfa_enrollment_key",
        SecretStr("different-enrollment-key-with-enough-entropy"),
    )

    with pytest.raises(RuntimeError, match="must be different"):
        _validate_internal_ops_config()


def test_ops_responses_are_never_cacheable(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "cache-ceo@ops-test.com")
    _signup_login(client, "cache-ceo@ops-test.com", "Cache HQ")

    response = client.get("/api/v1/internal/ops/me")

    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["pragma"] == "no-cache"


def test_every_ops_route_has_founder_guard_and_privileged_db():
    def dependency_calls(dependant):
        calls = {dependency.call for dependency in dependant.dependencies}
        for dependency in dependant.dependencies:
            calls.update(dependency_calls(dependency))
        return calls

    routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/v1/internal/ops")
    ]
    assert routes
    for route in routes:
        calls = dependency_calls(route.dependant)
        if route.path.startswith("/api/v1/internal/ops/mfa"):
            assert require_internal_founder in calls, route.path
        else:
            assert require_internal_admin in calls, route.path
        assert get_privileged_db in calls, route.path
        assert get_db not in calls, route.path

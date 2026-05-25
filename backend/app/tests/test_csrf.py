"""Negative CSRF tests for cookie-authenticated state-changing endpoints (Sprint Audit)."""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app as fastapi_app

# ── Helpers ────────────────────────────────────────────────────────────────


def _signup_and_verify(c: TestClient, email: str = "csrf@example.com") -> dict:
    r = c.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": "Acme"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    v = c.post("/api/v1/auth/verify", json={"token": data["dev_verification_token"]})
    assert v.status_code == 200, v.text
    return data


def _login(c: TestClient, email: str = "csrf@example.com") -> None:
    r = c.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert r.status_code == 200, r.text


def _raw_client(db) -> TestClient:  # noqa: ARG001 — db fixture ensures rollback
    """A TestClient that does NOT auto-inject CSRF — the middleware sees raw."""
    client = TestClient(fastapi_app, raise_server_exceptions=True)
    client._disable_auto_csrf = True
    return client


# ── Login issues a CSRF cookie ─────────────────────────────────────────────


def test_login_sets_csrf_cookie(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    assert c.cookies.get("csrf_token"), c.cookies.jar


def test_logout_clears_csrf_cookie(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    token = c.cookies.get("csrf_token")
    assert token
    r = c.post("/api/v1/auth/logout", headers={"x-csrf-token": token})
    assert r.status_code == 204, r.text
    assert not c.cookies.get("csrf_token")


# ── Negative path: missing or wrong header rejected ────────────────────────


def test_post_without_csrf_header_is_rejected(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post("/api/v1/catalog/categories", json={"name": "Drinks"})
    assert r.status_code == 403
    assert r.json()["detail"] == "CSRF validation failed"


def test_post_with_wrong_csrf_header_is_rejected(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post(
        "/api/v1/catalog/categories",
        json={"name": "Drinks"},
        headers={"x-csrf-token": "definitely-not-the-real-token"},
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "CSRF validation failed"


def test_post_with_correct_csrf_header_succeeds(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    token = c.cookies.get("csrf_token")
    assert token
    r = c.post(
        "/api/v1/catalog/categories",
        json={"name": "Drinks"},
        headers={"x-csrf-token": token},
    )
    assert r.status_code == 201, r.text


def test_refund_endpoint_requires_csrf(db):
    """Refunds are explicitly called out in the sprint requirement."""
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post(
        "/api/v1/orders/00000000-0000-0000-0000-000000000000/refunds",
        json={"reason": "x", "items": [], "method": "cash"},
        headers={"Idempotency-Key": "test-refund-1"},
    )
    assert r.status_code == 403, r.text


def test_void_endpoint_requires_csrf(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post(
        "/api/v1/orders/00000000-0000-0000-0000-000000000000/void",
        json={"reason": "x"},
        headers={"Idempotency-Key": "test-void-1"},
    )
    assert r.status_code == 403


def test_refresh_endpoint_requires_csrf(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post("/api/v1/auth/refresh")
    assert r.status_code == 403


def test_logout_requires_csrf(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post("/api/v1/auth/logout")
    assert r.status_code == 403


def test_sync_offline_sales_requires_csrf(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.post("/api/v1/sync/offline-sales", json={"sales": []})
    assert r.status_code == 403


# ── GET requests never require CSRF ────────────────────────────────────────


def test_get_request_without_csrf_succeeds(db):
    c = _raw_client(db)
    _signup_and_verify(c)
    _login(c)
    r = c.get("/api/v1/auth/me")
    assert r.status_code == 200


# ── Exempt paths ───────────────────────────────────────────────────────────


def test_login_without_csrf_succeeds(db):
    """Login is exempt — no cookies exist yet."""
    c = _raw_client(db)
    _signup_and_verify(c, email="login-exempt@example.com")
    r = c.post(
        "/api/v1/auth/login",
        json={"email": "login-exempt@example.com", "password": "S3cur3pass!"},
    )
    assert r.status_code == 200


def test_signup_without_csrf_succeeds(db):
    c = _raw_client(db)
    r = c.post(
        "/api/v1/auth/signup",
        json={
            "email": "signup-exempt@example.com",
            "password": "S3cur3pass!",
            "tenant_name": "Acme",
        },
    )
    assert r.status_code == 201


def test_stripe_webhook_without_csrf_succeeds(db):
    """Stripe webhooks authenticate via signature, not CSRF."""
    c = _raw_client(db)
    r = c.post(
        "/api/v1/billing/webhooks/stripe",
        content=b"{}",
        headers={"content-type": "application/json"},
    )
    assert r.status_code != 403 or r.json().get("detail") != "CSRF validation failed"


def test_internal_key_bypasses_csrf(db, monkeypatch):
    """Endpoints called with a valid X-Internal-Key bypass CSRF entirely."""
    monkeypatch.setattr(settings, "internal_api_key", "test-internal-key")
    c = _raw_client(db)
    _signup_and_verify(c, email="internal@example.com")
    _login(c)
    r = c.post(
        "/api/v1/billing/cancel",
        headers={"x-internal-key": "test-internal-key"},
    )
    assert not (
        r.status_code == 403 and r.json().get("detail") == "CSRF validation failed"
    )


def test_unauthenticated_post_does_not_require_csrf(db):
    """A POST with no auth cookies should be evaluated by the route, not blocked by CSRF."""
    c = _raw_client(db)
    r = c.post("/api/v1/catalog/categories", json={"name": "x"})
    assert r.status_code == 401


# ── Constant-time comparison sanity ────────────────────────────────────────


@pytest.mark.parametrize(
    "header_value",
    ["", "short", "x" * 64],
)
def test_csrf_rejects_various_bad_headers(db, header_value):
    c = _raw_client(db)
    _signup_and_verify(c, email=f"bad-{len(header_value)}@example.com")
    _login(c)
    r = c.post(
        "/api/v1/catalog/categories",
        json={"name": "Drinks"},
        headers={"x-csrf-token": header_value},
    )
    assert r.status_code == 403

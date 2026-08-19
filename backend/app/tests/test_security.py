"""Security headers and rate limiting tests (Sprint 14)."""
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import _validate_config


def test_api_response_includes_security_headers(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["permissions-policy"] == "geolocation=(), microphone=(), camera=()"


def test_api_response_denies_all_content_loading_via_csp(client: TestClient) -> None:
    # The API returns JSON and image bytes only. If a response is ever rendered
    # directly in a browser, nothing in it may execute or be framed.
    csp = client.get("/health").headers["content-security-policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


def test_docs_are_exempt_from_the_api_csp(client: TestClient) -> None:
    # Swagger UI loads CDN assets and runs inline scripts; the API policy would
    # break it. Docs are disabled entirely in production (docs_url=None).
    response = client.get("/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers


def test_hsts_not_set_in_local_env(client: TestClient) -> None:
    # Tests run with APP_ENV=local — HSTS must be absent
    response = client.get("/health")
    assert "strict-transport-security" not in response.headers


def test_config_rejects_production_stripe_test_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "production-secret-key")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)

    with pytest.raises(RuntimeError, match="STRIPE_SECRET_KEY must use live mode"):
        _validate_config()


def test_config_allows_explicit_production_stripe_test_mode(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "production-secret-key")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", True)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_123")
    monkeypatch.setattr(settings, "email_from", "hola@kova.example")
    monkeypatch.setattr(settings, "app_database_url", "postgresql://kova_app@runtime/db")
    monkeypatch.setattr(settings, "migration_database_url", "postgresql://owner@migration/db")
    monkeypatch.setattr(settings, "internal_admin_emails", "")
    monkeypatch.setattr(settings, "internal_admin_user_id", None)

    _validate_config()


def test_login_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    # Override app_env so the limiter is active (it skips in local/test mode)
    monkeypatch.setattr(settings, "app_env", "staging")
    test_ip = "192.0.2.11"  # TEST-NET range — unique to this test
    payload = {"email": "ratelimit@example.com", "password": "wrongpassword"}
    for _ in range(20):
        client.post(
            "/api/v1/auth/login",
            json=payload,
            headers={"Fly-Client-IP": test_ip},
        )
    response = client.post(
        "/api/v1/auth/login",
        json=payload,
        headers={"Fly-Client-IP": test_ip},
    )
    assert response.status_code == 429
    # Retry-After counts down from the oldest in-window hit. Login now runs bcrypt
    # on every attempt (including unknown emails — the timing-equalization fix), so
    # 20 sequential attempts span a couple of seconds and the value is legitimately
    # a hair under the 60s window rather than exactly 60. Assert it's a sane
    # countdown within the window instead of an exact value.
    retry_after = int(response.headers.get("retry-after", "0"))
    assert 1 <= retry_after <= 60


def test_signup_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "staging")
    test_ip = "192.0.2.12"
    payload = {"email": "spam@example.com", "password": "S3cur3pass!", "tenant_name": "Spam", "accepted_terms": True}
    for _ in range(10):
        client.post(
            "/api/v1/auth/signup",
            json=payload,
            headers={"Fly-Client-IP": test_ip},
        )
    response = client.post(
        "/api/v1/auth/signup",
        json=payload,
        headers={"Fly-Client-IP": test_ip},
    )
    assert response.status_code == 429


def test_password_reset_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "staging")
    test_ip = "192.0.2.13"
    payload = {"email": "reset@example.com"}
    for _ in range(5):
        client.post(
            "/api/v1/auth/password-reset/request",
            json=payload,
            headers={"Fly-Client-IP": test_ip},
        )
    response = client.post(
        "/api/v1/auth/password-reset/request",
        json=payload,
        headers={"Fly-Client-IP": test_ip},
    )
    assert response.status_code == 429


def test_rate_limit_is_per_ip(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "staging")
    ip_a = "192.0.2.21"
    ip_b = "192.0.2.22"
    # Use a distinct email per IP so the per-account throttle (added in the auth
    # hardening review) doesn't cross over between IPs — this test isolates the
    # per-IP dimension specifically.
    for _ in range(20):
        client.post(
            "/api/v1/auth/login",
            json={"email": "ip-a@example.com", "password": "wrong1"},
            headers={"Fly-Client-IP": ip_a},
        )
    # ip_a is now throttled
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "ip-a@example.com", "password": "wrong1"},
        headers={"Fly-Client-IP": ip_a},
    ).status_code == 429
    # ip_b is independent — first request should not be throttled (returns 401 for bad creds)
    response_b = client.post(
        "/api/v1/auth/login",
        json={"email": "ip-b@example.com", "password": "wrong1"},
        headers={"Fly-Client-IP": ip_b},
    )
    assert response_b.status_code != 429


def test_login_per_account_rate_limit_across_ips(client: TestClient, monkeypatch) -> None:
    """A distributed password-spray (rotating IPs, one target account) is bounded
    by the per-account throttle even though no single IP hits its limit."""
    monkeypatch.setattr(settings, "app_env", "staging")
    email = "spray-target@example.com"
    # 10 allowed per account / 10 min; each attempt from a fresh IP so the per-IP
    # limiter never fires and only the per-account bucket can trip.
    for i in range(10):
        client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong1"},
            headers={"Fly-Client-IP": f"198.51.100.{i}"},
        )
    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "wrong1"},
        headers={"Fly-Client-IP": "198.51.100.200"},
    )
    assert blocked.status_code == 429


def test_verify_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "staging")
    ip = "203.0.113.1"
    for _ in range(20):
        client.post(
            "/api/v1/auth/verify", json={"token": "x"}, headers={"Fly-Client-IP": ip}
        )
    response = client.post(
        "/api/v1/auth/verify", json={"token": "x"}, headers={"Fly-Client-IP": ip}
    )
    assert response.status_code == 429


def test_password_reset_confirm_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "staging")
    ip = "203.0.113.2"
    payload = {"token": "x", "new_password": "N3wpass!"}
    for _ in range(10):
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json=payload,
            headers={"Fly-Client-IP": ip},
        )
    response = client.post(
        "/api/v1/auth/password-reset/confirm",
        json=payload,
        headers={"Fly-Client-IP": ip},
    )
    assert response.status_code == 429

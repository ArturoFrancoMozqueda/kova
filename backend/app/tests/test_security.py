"""Security headers and rate limiting tests (Sprint 14)."""
from fastapi.testclient import TestClient


def test_api_response_includes_security_headers(client: TestClient) -> None:
    response = client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_hsts_not_set_in_local_env(client: TestClient) -> None:
    # Tests run with APP_ENV=local — HSTS must be absent
    response = client.get("/health")
    assert "strict-transport-security" not in response.headers


def test_login_rate_limit_returns_429(client: TestClient) -> None:
    test_ip = "192.0.2.11"  # TEST-NET range — unique to this test
    payload = {"email": "ratelimit@example.com", "password": "wrongpassword"}
    for _ in range(20):
        client.post(
            "/api/v1/auth/login",
            json=payload,
            headers={"X-Forwarded-For": test_ip},
        )
    response = client.post(
        "/api/v1/auth/login",
        json=payload,
        headers={"X-Forwarded-For": test_ip},
    )
    assert response.status_code == 429
    assert response.headers.get("retry-after") == "60"


def test_signup_rate_limit_returns_429(client: TestClient) -> None:
    test_ip = "192.0.2.12"
    payload = {"email": "spam@example.com", "password": "S3cur3pass!", "tenant_name": "Spam"}
    for _ in range(10):
        client.post(
            "/api/v1/auth/signup",
            json=payload,
            headers={"X-Forwarded-For": test_ip},
        )
    response = client.post(
        "/api/v1/auth/signup",
        json=payload,
        headers={"X-Forwarded-For": test_ip},
    )
    assert response.status_code == 429


def test_password_reset_rate_limit_returns_429(client: TestClient) -> None:
    test_ip = "192.0.2.13"
    payload = {"email": "reset@example.com"}
    for _ in range(5):
        client.post(
            "/api/v1/auth/password-reset/request",
            json=payload,
            headers={"X-Forwarded-For": test_ip},
        )
    response = client.post(
        "/api/v1/auth/password-reset/request",
        json=payload,
        headers={"X-Forwarded-For": test_ip},
    )
    assert response.status_code == 429


def test_rate_limit_is_per_ip(client: TestClient) -> None:
    # Different IPs should have independent windows
    ip_a = "192.0.2.21"
    ip_b = "192.0.2.22"
    payload = {"email": "x@example.com", "password": "x"}
    for _ in range(20):
        client.post("/api/v1/auth/login", json=payload, headers={"X-Forwarded-For": ip_a})
    # ip_a is now throttled
    assert client.post(
        "/api/v1/auth/login", json=payload, headers={"X-Forwarded-For": ip_a}
    ).status_code == 429
    # ip_b is independent — first request should not be throttled (returns 400 for bad creds)
    response_b = client.post(
        "/api/v1/auth/login", json=payload, headers={"X-Forwarded-For": ip_b}
    )
    assert response_b.status_code != 429

"""Identity and business responses must not enter browser or shared HTTP caches."""

import pytest

from app.tests.test_auth import _signup, _verify, signup_and_login


def _assert_private_no_store(response):
    directives = {value.strip() for value in response.headers.get("cache-control", "").split(",")}
    assert {"private", "no-store", "max-age=0"} <= directives
    assert response.headers.get("cdn-cache-control") == "no-store"
    assert response.headers.get("vercel-cdn-cache-control") == "no-store"
    assert response.headers.get("pragma") == "no-cache"


@pytest.mark.parametrize("path", [
    "/api/v1/auth/session", "/api/v1/auth/me", "/api/v1/reports/sales-summary",
    "/api/v1/catalog/products", "/api/v1/billing/subscription",
])
def test_authenticated_identity_and_business_reads_are_private(client, path):
    signup_and_login(client)
    response = client.get(path)
    assert response.status_code == 200
    _assert_private_no_store(response)


def test_anonymous_session_probe_and_unauthorized_business_read_are_not_cached(client):
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    assert response.json()["authenticated"] is False
    _assert_private_no_store(response)
    response = client.get("/api/v1/catalog/products")
    assert response.status_code == 401
    _assert_private_no_store(response)


def test_auth_cookie_issuance_rotation_and_deletion_are_not_cached(client):
    signup = _signup(client)
    _verify(client, signup["dev_verification_token"])
    for path, body, status in [
        ("/api/v1/auth/login", {"email": "owner@example.com", "password": "S3cur3pass!"}, 200),
        ("/api/v1/auth/refresh", None, 200),
        ("/api/v1/auth/logout", None, 204),
    ]:
        response = client.post(path, json=body)
        assert response.status_code == status
        assert response.headers.get("set-cookie")
        _assert_private_no_store(response)


def test_anonymous_token_issuance_is_not_cached(client):
    response = client.post(
        "/api/v1/telemetry/events/anonymous/session", json={"client_id": "cache-privacy"}
    )
    assert response.status_code == 200
    _assert_private_no_store(response)


def test_health_cache_policy_is_unchanged(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert "cache-control" not in response.headers
    assert "cdn-cache-control" not in response.headers
    assert "vercel-cdn-cache-control" not in response.headers

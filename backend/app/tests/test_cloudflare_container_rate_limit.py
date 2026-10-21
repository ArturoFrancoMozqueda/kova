"""Native migration keeps the same durable buckets and failure contract."""

import hashlib
import hmac
import json

import httpx
import pytest

from app.config import Settings, settings
from app.middleware import rate_limit as rl
from app.middleware.cloudflare_rate_limit import CloudflareContainerRateLimiter


@pytest.fixture
def bridge():
    limiter = CloudflareContainerRateLimiter()
    yield limiter
    limiter._client.close()
    rl._reset_backend_for_tests()


def _transport(limiter, handler):
    limiter._client.close()
    limiter._client = httpx.Client(
        transport=httpx.MockTransport(handler), trust_env=False, follow_redirects=False
    )


def test_container_bridge_preserves_existing_workers_bucket(bridge, monkeypatch):
    secret = "synthetic-signing-key"
    key = "login:203.0.113.2:synthetic@example.test"
    monkeypatch.setattr(settings, "secret_key", secret)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"allowed": True, "retryAfter": 0})

    _transport(bridge, handler)
    assert bridge.is_allowed(key, 5, 60, fail_closed=True) == (True, 0)
    request = calls[0]
    assert str(request.url) == "http://rate-limit.kova.internal/allow"
    assert request.method == "POST"
    assert json.loads(request.content) == {
        "bucket": hmac.digest(secret.encode(), key.encode(), hashlib.sha256).hex() + "-60",
        "maximum": 5,
        "windowSeconds": 60,
    }
    assert key.encode() not in request.content
    assert secret.encode() not in request.content


def test_container_bridge_returns_shared_limit_exhaustion(bridge):
    _transport(bridge, lambda request: httpx.Response(
        200, json={"allowed": False, "retryAfter": 23}
    ))
    assert bridge.is_allowed("synthetic-bucket", 5, 60) == (False, 23)


@pytest.mark.parametrize("result", [
    [], {}, {"allowed": "true", "retryAfter": 0},
    {"allowed": 1, "retryAfter": 0}, {"allowed": True, "retryAfter": False},
    {"allowed": True, "retryAfter": 1}, {"allowed": False, "retryAfter": 0},
    {"allowed": False, "retryAfter": -1}, {"allowed": False, "retryAfter": 61},
    {"allowed": False, "retryAfter": "20"},
])
def test_container_bridge_malformed_result_fails_auth_closed(bridge, result):
    _transport(bridge, lambda request: httpx.Response(200, json=result))
    assert bridge.is_allowed("synthetic-bucket", 5, 60, fail_closed=True) == (False, 30)


@pytest.mark.parametrize("status", [301, 401, 429, 500, 503])
def test_container_bridge_http_error_respects_fail_closed(bridge, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "https://invalid.example/"})

    _transport(bridge, handler)
    assert bridge.is_allowed("synthetic-bucket", 5, 60, fail_closed=True) == (False, 30)
    assert bridge.is_allowed("synthetic-bucket", 5, 60, fail_closed=False) == (True, 0)
    assert len(calls) == 2  # Redirects are never followed out of the private binding.


def test_container_bridge_transport_outage_does_not_log_identifiers(bridge, caplog):
    def handler(request):
        raise httpx.ConnectError("synthetic-account-secret", request=request)

    _transport(bridge, handler)
    assert bridge.is_allowed("synthetic-account-secret", 5, 60, fail_closed=True) == (False, 30)
    assert "synthetic-account-secret" not in caplog.text
    assert bridge.is_allowed("synthetic-account-secret", 5, 60) == (True, 0)


def test_factory_container_mode_overrides_redis_and_memory(monkeypatch):
    monkeypatch.setattr(settings, "cloudflare_container_mode", True)
    monkeypatch.setattr(settings, "upstash_redis_rest_url", "https://redis.example.invalid")
    monkeypatch.setattr(settings, "upstash_redis_rest_token", "synthetic")
    rl._reset_backend_for_tests()
    try:
        selected = rl._get_backend()
        assert isinstance(selected, CloudflareContainerRateLimiter)
        assert selected is rl._get_backend()
    finally:
        if isinstance(rl._backend, CloudflareContainerRateLimiter):
            rl._backend._client.close()
        rl._reset_backend_for_tests()


def test_factory_container_initialization_failure_never_uses_memory(monkeypatch):
    from app.middleware import cloudflare_rate_limit

    monkeypatch.setattr(settings, "cloudflare_container_mode", True)

    def unavailable():
        raise RuntimeError("synthetic container bridge initialization failure")

    monkeypatch.setattr(cloudflare_rate_limit, "CloudflareContainerRateLimiter", unavailable)
    rl._reset_backend_for_tests()
    try:
        with pytest.raises(RuntimeError, match="bridge initialization failure"):
            rl._get_backend()
        assert rl._backend is None
    finally:
        rl._reset_backend_for_tests()


def test_container_mode_is_explicit_operator_opt_in(monkeypatch):
    monkeypatch.delenv("CLOUDFLARE_CONTAINER_MODE", raising=False)
    assert Settings(_env_file=None).cloudflare_container_mode is False
    monkeypatch.setenv("CLOUDFLARE_CONTAINER_MODE", "true")
    assert Settings(_env_file=None).cloudflare_container_mode is True

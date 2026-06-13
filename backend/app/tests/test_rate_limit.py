"""Unit tests for the rate-limit backend abstraction.

Bypasses the FastAPI dependency (which is disabled in app_env=local) and
calls the backend directly so we can exercise allow/deny/reset behavior.

The Upstash backend itself is not hit in CI; we only verify the factory
selects it correctly when the env vars are set, and we mock the limiter
call when validating the wrapper logic.
"""
import time
from unittest.mock import MagicMock

from app.config import settings
from app.middleware import rate_limit as rl

# ── In-memory backend ──────────────────────────────────────────────────────


def test_in_memory_allows_under_threshold():
    backend = rl._InMemoryBackend()
    for i in range(5):
        allowed, retry = backend.is_allowed("client-1", max_requests=5, window_seconds=60)
        assert allowed, f"expected allow on call {i}"
        assert retry == 0


def test_in_memory_blocks_over_threshold():
    backend = rl._InMemoryBackend()
    for _ in range(5):
        backend.is_allowed("client-2", max_requests=5, window_seconds=60)
    allowed, retry = backend.is_allowed("client-2", max_requests=5, window_seconds=60)
    assert not allowed
    assert retry >= 1
    assert retry <= 60


def test_in_memory_buckets_are_independent_by_key():
    backend = rl._InMemoryBackend()
    for _ in range(3):
        backend.is_allowed("alice", max_requests=3, window_seconds=60)
    # alice is at her cap
    allowed_alice, _ = backend.is_allowed("alice", max_requests=3, window_seconds=60)
    assert not allowed_alice
    # bob should still pass
    allowed_bob, _ = backend.is_allowed("bob", max_requests=3, window_seconds=60)
    assert allowed_bob


def test_in_memory_buckets_are_independent_by_window():
    backend = rl._InMemoryBackend()
    # Fill the (key, 60s) bucket
    for _ in range(3):
        backend.is_allowed("alice", max_requests=3, window_seconds=60)
    # A different window for the same key should not be affected
    allowed, _ = backend.is_allowed("alice", max_requests=3, window_seconds=30)
    assert allowed


def test_in_memory_resets_after_window():
    backend = rl._InMemoryBackend()
    # Use a 1-second window so the test doesn't take long
    for _ in range(2):
        backend.is_allowed("client", max_requests=2, window_seconds=1)
    allowed_now, _ = backend.is_allowed("client", max_requests=2, window_seconds=1)
    assert not allowed_now
    time.sleep(1.2)
    allowed_after, _ = backend.is_allowed("client", max_requests=2, window_seconds=1)
    assert allowed_after


# ── Factory selection ──────────────────────────────────────────────────────


def test_factory_falls_back_to_memory_when_upstash_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "upstash_redis_rest_url", None)
    monkeypatch.setattr(settings, "upstash_redis_rest_token", None)
    rl._reset_backend_for_tests()
    backend = rl._get_backend()
    assert isinstance(backend, rl._InMemoryBackend)
    rl._reset_backend_for_tests()


def test_factory_selects_upstash_when_configured(monkeypatch):
    """Verify the factory tries to construct UpstashBackend when env is set.

    We can't actually connect — and we don't want CI to try — so we patch
    the Upstash backend constructor to a no-op fake before triggering the
    factory.
    """
    monkeypatch.setattr(settings, "upstash_redis_rest_url", "https://example.upstash.io")
    monkeypatch.setattr(settings, "upstash_redis_rest_token", "fake-token")

    class _FakeUpstash:
        def __init__(self, url, token):  # noqa: ARG002 — fake signature match
            pass

        def is_allowed(self, key, max_requests, window_seconds):  # noqa: ARG002
            return True, 0

    monkeypatch.setattr(rl, "_UpstashBackend", _FakeUpstash)
    rl._reset_backend_for_tests()
    backend = rl._get_backend()
    assert isinstance(backend, _FakeUpstash)
    rl._reset_backend_for_tests()


def test_factory_falls_back_if_upstash_init_raises(monkeypatch):
    monkeypatch.setattr(settings, "upstash_redis_rest_url", "https://example.upstash.io")
    monkeypatch.setattr(settings, "upstash_redis_rest_token", "fake-token")

    class _BrokenUpstash:
        def __init__(self, url, token):  # noqa: ARG002
            raise RuntimeError("simulated init failure")

    monkeypatch.setattr(rl, "_UpstashBackend", _BrokenUpstash)
    rl._reset_backend_for_tests()
    backend = rl._get_backend()
    # On init failure, factory falls back to in-memory rather than crashing the app
    assert isinstance(backend, rl._InMemoryBackend)
    rl._reset_backend_for_tests()


# ── Dependency behavior (disabled in local env) ────────────────────────────


def test_rate_limit_dependency_is_noop_in_local_env():
    """The factory dependency must be a no-op when app_env == 'local'.

    The dependency only raises if the backend denies; in local env it skips
    the backend entirely. We verify it returns without raising regardless
    of how many times we call it.
    """
    fake_request = MagicMock()
    fake_request.headers = {}
    fake_request.client = MagicMock()
    fake_request.client.host = "1.2.3.4"
    fake_request.scope = {}
    fake_request.url.path = "/api/v1/test"

    dep = rl.rate_limit(max_requests=2, window_seconds=60, key="test-bucket")
    # settings.app_env is already "local" in tests, so all calls should pass
    for _ in range(20):
        dep(fake_request)  # should not raise


# ── Upstash wrapper fail-open behavior ─────────────────────────────────────


def test_upstash_backend_fails_open_on_exception(monkeypatch):
    """If Upstash raises mid-call we allow the request rather than locking everyone out."""
    backend_instance = rl._InMemoryBackend.__new__(rl._UpstashBackend)
    # Skip __init__ to avoid the real Upstash import / network.
    backend_instance._cache = {}  # type: ignore[attr-defined]
    backend_instance._lock = rl.Lock()  # type: ignore[attr-defined]

    def broken_get_ratelimit(*a, **kw):  # noqa: ARG001
        class _Bad:
            def limit(self_inner, _key):
                raise RuntimeError("simulated upstash outage")

        return _Bad()

    backend_instance._get_ratelimit = broken_get_ratelimit  # type: ignore[attr-defined]
    allowed, retry = rl._UpstashBackend.is_allowed(
        backend_instance, "any-key", 5, 60
    )
    assert allowed is True
    assert retry == 0


def _broken_upstash_instance():
    backend_instance = rl._InMemoryBackend.__new__(rl._UpstashBackend)
    backend_instance._cache = {}  # type: ignore[attr-defined]
    backend_instance._lock = rl.Lock()  # type: ignore[attr-defined]

    def broken_get_ratelimit(*a, **kw):  # noqa: ARG001
        class _Bad:
            def limit(self_inner, _key):
                raise RuntimeError("simulated upstash outage")

        return _Bad()

    backend_instance._get_ratelimit = broken_get_ratelimit  # type: ignore[attr-defined]
    return backend_instance


def test_upstash_backend_fails_closed_when_requested():
    """Auth endpoints opt into fail_closed: a backend outage must DENY so a
    Redis blip can't open an unbounded brute-force window."""
    backend_instance = _broken_upstash_instance()
    allowed, retry = rl._UpstashBackend.is_allowed(
        backend_instance, "any-key", 5, 60, fail_closed=True
    )
    assert allowed is False
    assert retry == rl._FAIL_CLOSED_RETRY_SECONDS


def test_dependency_fail_closed_only_applies_in_production(monkeypatch):
    """fail_closed must be inert outside production so staging/local outages
    don't lock developers out, and active in production."""
    backend_instance = _broken_upstash_instance()
    monkeypatch.setattr(rl, "_get_backend", lambda: backend_instance)

    fake_request = MagicMock()
    fake_request.headers = {}
    fake_request.client = MagicMock()
    fake_request.client.host = "1.2.3.4"
    fake_request.scope = {}
    fake_request.url.path = "/api/v1/auth/login"

    dep = rl.rate_limit(20, key="auth-login", fail_closed=True)

    # Staging: backend errors but the dependency still allows (fail-open).
    monkeypatch.setattr(settings, "app_env", "staging")
    dep(fake_request)  # must not raise

    # Production: the same outage now denies with 429 + Retry-After.
    monkeypatch.setattr(settings, "app_env", "production")
    try:
        dep(fake_request)
        raise AssertionError("expected the dependency to deny in production")
    except rl.HTTPException as exc:
        assert exc.status_code == 429
        assert exc.headers["Retry-After"] == str(rl._FAIL_CLOSED_RETRY_SECONDS)

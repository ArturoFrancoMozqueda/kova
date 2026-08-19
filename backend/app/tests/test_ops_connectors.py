"""Internal ops dashboard — external connector + cache tests.

Connectors must: no-op (no network) when a token is missing, degrade (never
500) on failure, map upstream states to ops statuses, and honor the TTL cache.
"""
import io
from urllib.error import URLError

from app.config import settings
from app.ops import service
from app.ops.cache import TTLCache
from app.ops.connectors import base, sentry, uptimerobot
from app.tests.test_ops_auth import _signup_login

ADMIN = "conn-ceo@ops-test.com"


def _login_admin(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "Conn HQ")


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def test_sentry_not_configured_makes_no_network_call(monkeypatch):
    monkeypatch.setattr(settings, "sentry_api_token", None)
    called = False

    def _fail(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("must not hit the network")

    monkeypatch.setattr(base, "urlopen", _fail)
    result = sentry.fetch_unresolved_issues(timeout=1)
    assert result.status == "not_configured"
    assert called is False


def test_sentry_maps_fatal_issue_to_critical(monkeypatch):
    monkeypatch.setattr(settings, "sentry_api_token", "tok")
    monkeypatch.setattr(settings, "sentry_org_slug", "acme")
    monkeypatch.setattr(settings, "sentry_project_slug", "backend")

    payload = b'[{"id":"1","title":"boom","level":"fatal","count":"3","lastSeen":"x","permalink":"javascript:alert(1)"}]'
    monkeypatch.setattr(base, "urlopen", lambda *a, **k: _FakeResponse(payload))
    result = sentry.fetch_unresolved_issues(timeout=1)
    assert result.status == "critical"
    assert result.data["unresolved_24h"] == 1
    assert result.data["issues"][0]["permalink"] == "https://acme.sentry.io/issues/1/"
    assert "javascript:" not in result.data["issues"][0]["permalink"]


def test_connector_degrades_on_network_error(monkeypatch):
    monkeypatch.setattr(settings, "sentry_api_token", "tok")
    monkeypatch.setattr(settings, "sentry_org_slug", "acme")
    monkeypatch.setattr(settings, "sentry_project_slug", "backend")

    def _raise(*a, **k):
        raise URLError("connection refused")

    monkeypatch.setattr(base, "urlopen", _raise)
    result = sentry.fetch_unresolved_issues(timeout=1)
    assert result.status == "degraded"
    assert result.error_summary  # short, non-empty
    # secret token never appears in the surfaced summary
    assert "tok" not in (result.error_summary or "")


def test_uptimerobot_down_is_critical(monkeypatch):
    monkeypatch.setattr(settings, "uptimerobot_api_key", "key")
    payload = (
        b'{"stat":"ok","monitors":[{"friendly_name":"api","status":9,'
        b'"custom_uptime_ratio":"99.0-99.5-99.9"}]}'
    )
    monkeypatch.setattr(base, "urlopen", lambda *a, **k: _FakeResponse(payload))
    result = uptimerobot.fetch_monitors(timeout=1)
    assert result.status == "critical"
    assert result.data["monitors"][0]["uptime_7d"] == 99.5


def test_ttl_cache_reuses_and_expires():
    cache = TTLCache()
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        return calls["n"]

    assert cache.get_or_set("k", 100, fn) == 1
    assert cache.get_or_set("k", 100, fn) == 1  # cached, fn not called again
    assert calls["n"] == 1
    # A zero TTL forces recomputation on the next call.
    assert cache.get_or_set("k2", 0, fn) == 2
    assert cache.get_or_set("k2", 0, fn) == 3


def test_technical_endpoint_all_not_configured(client, monkeypatch):
    for field in ("sentry_api_token", "fly_api_token", "vercel_api_token", "uptimerobot_api_key"):
        monkeypatch.setattr(settings, field, None)
    _login_admin(client, monkeypatch)

    r = client.get("/api/v1/internal/ops/technical")
    assert r.status_code == 200
    body = r.json()
    assert body["db"]["status"] == "ok"
    for name in ("sentry", "fly", "vercel", "uptimerobot"):
        assert body[name]["status"] == "not_configured"


def test_fetch_all_connectors_isolates_failures(monkeypatch):
    # One connector explodes; the others must still return.
    monkeypatch.setattr(settings, "sentry_api_token", None)
    monkeypatch.setattr(settings, "fly_api_token", None)
    monkeypatch.setattr(settings, "vercel_api_token", None)
    monkeypatch.setattr(settings, "uptimerobot_api_key", "key")

    def _boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(uptimerobot, "fetch_monitors", _boom)
    results = service.fetch_all_connectors()
    assert results["uptimerobot"].status == "degraded"
    assert results["sentry"].status == "not_configured"

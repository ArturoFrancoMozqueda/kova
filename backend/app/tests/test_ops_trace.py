"""Internal ops dashboard — trace correlation and Sentry enrichment tests."""
from datetime import UTC, datetime
from uuid import uuid4

from app.auth.models import User
from app.billing.models import WebhookEvent
from app.config import settings
from app.telemetry.models import TelemetryEvent
from app.tenants.models import Tenant
from app.tests.test_ops_auth import _signup_login

ADMIN = "trace-ceo@ops-test.com"


def _login_admin(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "Trace HQ")


def test_trace_by_tenant_merges_and_orders(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    t = Tenant(id=uuid4(), name="Trace Co", slug=f"trace-{uuid4().hex[:6]}")
    db.add(t)
    db.flush()
    user_id = db.query(User.id).first()[0]

    db.add(
        TelemetryEvent(
            id=uuid4(), tenant_id=t.id, user_id=user_id,
            event_name="signup_completed", client_event_id=uuid4().hex,
            properties={}, created_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        )
    )
    db.add(
        WebhookEvent(
            id=uuid4(), tenant_id=t.id, stripe_event_id="evt_trace_1",
            event_type="customer.subscription.created", processing_status="processed",
            payload={"id": "evt_trace_1"}, created_at=datetime(2026, 1, 1, 11, 0, tzinfo=UTC),
        )
    )
    db.flush()

    r = client.get(f"/api/v1/internal/ops/trace?tenant_id={t.id}")
    assert r.status_code == 200
    body = r.json()
    sources = {e["source"] for e in body["timeline"]}
    assert "telemetry" in sources
    assert "stripe_webhook" in sources
    ts = [e["ts"] for e in body["timeline"]]
    assert ts == sorted(ts)  # ascending
    assert body["sources_queried"]["local_db"] == "ok"
    assert body["sources_queried"]["fly_logs"] == "deep_link_only"


def test_trace_by_stripe_event_is_sanitized(client, db, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_xyz")
    _login_admin(client, monkeypatch)
    db.add(
        WebhookEvent(
            id=uuid4(), tenant_id=None, stripe_event_id="evt_trace_2",
            event_type="invoice.payment_failed", processing_status="failed",
            payload={"data": {"object": {"card": {"number": "4242"}}}},
            created_at=datetime.now(UTC),
        )
    )
    db.flush()

    r = client.get("/api/v1/internal/ops/trace?stripe_event_id=evt_trace_2")
    body = r.json()
    assert any(e["source"] == "stripe_webhook" for e in body["timeline"])
    # deep link to /test dashboard; no card number anywhere.
    assert "/test/events/evt_trace_2" in r.text
    assert "4242" not in r.text


def test_trace_request_id_without_sentry_is_honest(client, monkeypatch):
    monkeypatch.setattr(settings, "sentry_api_token", None)
    _login_admin(client, monkeypatch)
    r = client.get("/api/v1/internal/ops/trace?request_id=abc-123")
    assert r.status_code == 200
    body = r.json()
    # No local table stores request_id, and Sentry is off → declared, not faked.
    assert body["sources_queried"]["sentry"] == "not_configured"
    assert body["query"]["request_id"] == "abc-123"


def test_trace_requires_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "nobody@ops-test.com")
    _signup_login(client, "trace-owner@ops-test.com", "Trace Owner Co")
    assert client.get("/api/v1/internal/ops/trace?request_id=x").status_code == 403


def test_sentry_enrichment_sets_release_and_tags(monkeypatch):
    """Sentry init uses git_sha as release, and set_request_context tags Sentry."""
    import app.observability.logging as logging_mod
    import app.observability.sentry as sentry_mod

    captured = {}

    def _fake_init(**kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(settings, "sentry_dsn", "https://x@example.com/1")
    monkeypatch.setattr(settings, "git_sha", "deadbeef")
    monkeypatch.setattr(sentry_mod.sentry_sdk, "init", _fake_init)
    sentry_mod.init_sentry()
    assert captured["release"] == "deadbeef"
    assert captured["send_default_pii"] is False

    tags = {}
    monkeypatch.setattr(
        logging_mod.sentry_sdk, "set_tag", lambda k, v: tags.__setitem__(k, v)
    )
    logging_mod.set_request_context(tenant_id="t-1", user_id="u-1")
    assert tags == {"tenant_id": "t-1", "user_id": "u-1"}

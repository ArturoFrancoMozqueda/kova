"""Internal ops dashboard — incident feed, detail, triage tests."""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import text

from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.ops import incidents as incidents_mod
from app.tenants.models import Tenant
from app.tests.test_ops_auth import _signup_login

ADMIN = "inc-ceo@ops-test.com"


def _login_admin(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "Inc HQ")


def _mk_webhook(db, *, event_id, status="failed", attempts=1, when=None, payload=None):
    db.add(
        WebhookEvent(
            id=uuid4(),
            tenant_id=None,
            stripe_event_id=event_id,
            event_type="invoice.payment_failed",
            processing_status=status,
            process_attempts=attempts,
            error_reason="card_declined" if status == "failed" else None,
            payload=payload,
            created_at=when or datetime.now(UTC),
        )
    )
    db.flush()


# ── Pure severity rules ───────────────────────────────────────────────────────


def test_webhook_severity_rules():
    now = datetime.now(UTC)
    recent_one = WebhookEvent(
        stripe_event_id="e", event_type="x", processing_status="failed",
        process_attempts=1, created_at=now,
    )
    assert incidents_mod.webhook_severity(recent_one, now=now) == "warning"

    many_attempts = WebhookEvent(
        stripe_event_id="e", event_type="x", processing_status="failed",
        process_attempts=3, created_at=now,
    )
    assert incidents_mod.webhook_severity(many_attempts, now=now) == "critical"

    old = WebhookEvent(
        stripe_event_id="e", event_type="x", processing_status="failed",
        process_attempts=1, created_at=now - timedelta(hours=25),
    )
    assert incidents_mod.webhook_severity(old, now=now) == "critical"


def test_subscription_severity_grace_expired():
    now = datetime.now(UTC)
    within = Subscription(
        tenant_id=uuid4(), status="past_due",
        grace_period_ends_at=now + timedelta(days=1),
    )
    assert incidents_mod.subscription_severity(within, now=now) == "warning"
    expired = Subscription(
        tenant_id=uuid4(), status="past_due",
        grace_period_ends_at=now - timedelta(days=1),
    )
    assert incidents_mod.subscription_severity(expired, now=now) == "critical"


# ── Feed / detail / triage ────────────────────────────────────────────────────


def test_failed_webhook_appears_in_feed(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(db, event_id="evt_feed_1", attempts=3)

    r = client.get("/api/v1/internal/ops/incidents")
    assert r.status_code == 200
    body = r.json()
    match = next((i for i in body["items"] if i["external_id"] == "evt_feed_1"), None)
    assert match is not None
    assert match["source"] == "stripe_webhook"
    assert match["severity"] == "critical"
    assert match["key"] == "stripe_webhook:evt_feed_1"
    assert match["triage"]["status"] == "new"


def test_incident_detail_timeline_ordered_and_sanitized(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(
        db,
        event_id="evt_detail_1",
        status="failed",
        attempts=2,
        payload={
            "id": "evt_detail_1",
            "type": "invoice.payment_failed",
            "data": {"object": {"id": "in_9", "card": {"number": "4242424242424242"}}},
        },
    )

    r = client.get("/api/v1/internal/ops/incidents/stripe_webhook:evt_detail_1")
    assert r.status_code == 200
    body = r.json()
    assert body["incident"]["external_id"] == "evt_detail_1"
    # timeline ascending by ts
    ts = [e["ts"] for e in body["timeline"]]
    assert ts == sorted(ts)
    # sanitized payload — no card data leaks
    assert "4242424242424242" not in r.text
    assert "card" not in str(body["detail"]["payload"])


def test_triage_persists_and_audits(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(db, event_id="evt_triage_1")

    r = client.patch(
        "/api/v1/internal/ops/incidents/stripe_webhook:evt_triage_1/triage",
        json={"triage_status": "investigating"},
    )
    assert r.status_code == 200
    assert r.json()["incident"]["triage"]["status"] == "investigating"

    row = db.execute(
        text(
            "SELECT triage_status FROM ops_incident_states "
            "WHERE source='stripe_webhook' AND external_id='evt_triage_1'"
        )
    ).scalar()
    assert row == "investigating"

    action = db.execute(
        text("SELECT action FROM audit_logs WHERE action='ops_incident_triage' LIMIT 1")
    ).scalar()
    assert action == "ops_incident_triage"


def test_triage_rejects_untrusted_origin(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(db, event_id="evt_bad_origin")

    response = client.patch(
        "/api/v1/internal/ops/incidents/stripe_webhook:evt_bad_origin/triage",
        json={"triage_status": "investigating"},
        headers={"origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Request origin is not allowed"


def test_snoozed_incident_hidden_unless_requested(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(db, event_id="evt_snooze_1")

    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    r = client.patch(
        "/api/v1/internal/ops/incidents/stripe_webhook:evt_snooze_1/triage",
        json={"snoozed_until": future},
    )
    assert r.status_code == 200

    # Hidden by default…
    body = client.get("/api/v1/internal/ops/incidents").json()
    assert not any(i["external_id"] == "evt_snooze_1" for i in body["items"])
    # …but visible when explicitly requested.
    body = client.get("/api/v1/internal/ops/incidents?include_snoozed=true").json()
    assert any(i["external_id"] == "evt_snooze_1" for i in body["items"])


def test_incident_filters(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    _mk_webhook(db, event_id="evt_filter_crit", attempts=3)  # critical
    t = Tenant(id=uuid4(), name="Filter Co", slug=f"filter-{uuid4().hex[:6]}")
    db.add(t)
    db.flush()
    db.add(
        Subscription(
            id=uuid4(), tenant_id=t.id, status="past_due",
            past_due_at=datetime.now(UTC), grace_period_ends_at=datetime.now(UTC) + timedelta(days=2),
        )
    )
    db.flush()

    body = client.get("/api/v1/internal/ops/incidents?source=subscription").json()
    assert all(i["source"] == "subscription" for i in body["items"])
    assert any(i["source"] == "subscription" for i in body["items"])

    body = client.get("/api/v1/internal/ops/incidents?severity=critical").json()
    assert all(i["severity"] == "critical" for i in body["items"])


def test_unknown_incident_404(client, monkeypatch):
    _login_admin(client, monkeypatch)
    r = client.get("/api/v1/internal/ops/incidents/stripe_webhook:does_not_exist")
    assert r.status_code == 404


def test_incidents_require_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "nobody@ops-test.com")
    _signup_login(client, "inc-owner@ops-test.com", "Inc Owner Co")
    assert client.get("/api/v1/internal/ops/incidents").status_code == 403

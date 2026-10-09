"""Signed Stripe test events must never activate a live-production subscription."""

import hashlib
import hmac
import json
import time
from uuid import uuid4

import pytest

from app.billing import service
from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.tenants import repository as tenants

_SYNTHETIC_SIGNING_SECRET = "whsec_synthetic_opaque_signing_secret"  # gitleaks:allow


def _signature(payload):
    timestamp = int(time.time())
    digest = hmac.new(
        _SYNTHETIC_SIGNING_SECRET.encode(), str(timestamp).encode() + b"." + payload,
        hashlib.sha256,
    ).hexdigest()
    return f"t={timestamp},v1={digest}"


def _signed_event(tenant_id, mode):
    event = {
        "id": f"evt_{uuid4().hex}",
        "type": "checkout.session.completed",
        "created": int(time.time()),
        "data": {"object": {
            "id": "cs_synthetic", "object": "checkout.session",
            "subscription": "sub_synthetic", "customer": "cus_synthetic",
            "metadata": {"tenant_id": str(tenant_id)}, "payment_status": "paid",
        }},
    }
    if mode is not None:
        event["livemode"] = mode
    payload = json.dumps(event).encode()
    return event["id"], payload, _signature(payload)


@pytest.mark.parametrize("mode", [False, None, "true", 1])
def test_live_production_rejects_non_live_signed_event_without_writes(
    client, db, monkeypatch, mode
):
    tenant = tenants.create(db, name="Mode guard", slug=f"mode-{uuid4().hex}")
    db.add(Subscription(tenant_id=tenant.id, status="canceled"))
    db.commit()
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    monkeypatch.setattr(settings, "stripe_webhook_secret", _SYNTHETIC_SIGNING_SECRET)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    monkeypatch.setattr(service, "_send_welcome_email_for_tenant", lambda *_a, **_k: None)
    event_id, payload, signature = _signed_event(tenant.id, mode)

    response = client.post(
        "/api/v1/billing/webhooks/stripe", content=payload,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 400
    assert db.query(Subscription).filter_by(tenant_id=tenant.id).one().status == "canceled"
    assert db.query(WebhookEvent).filter_by(stripe_event_id=event_id).count() == 0


@pytest.mark.parametrize(
    ("environment", "allow_test", "mode"),
    [("production", False, True), ("production", True, False), ("local", False, False)],
)
def test_webhook_live_or_explicit_test_modes_still_process(
    client, db, monkeypatch, environment, allow_test, mode
):
    tenant = tenants.create(db, name="Allowed mode", slug=f"mode-{uuid4().hex}")
    db.commit()
    monkeypatch.setattr(settings, "app_env", environment)
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", allow_test)
    monkeypatch.setattr(settings, "stripe_webhook_secret", _SYNTHETIC_SIGNING_SECRET)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    monkeypatch.setattr(service, "_send_welcome_email_for_tenant", lambda *_a, **_k: None)
    event_id, payload, signature = _signed_event(tenant.id, mode)

    response = client.post(
        "/api/v1/billing/webhooks/stripe", content=payload,
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "processed"}
    assert db.query(Subscription).filter_by(tenant_id=tenant.id).one().status == "active"
    assert db.query(WebhookEvent).filter_by(stripe_event_id=event_id).count() == 1


@pytest.mark.parametrize("payload", [b"[]", b"null", b'"scalar"', b"\xff"])
def test_signed_invalid_webhook_payload_is_rejected(client, monkeypatch, payload):
    monkeypatch.setattr(settings, "stripe_webhook_secret", _SYNTHETIC_SIGNING_SECRET)
    response = client.post(
        "/api/v1/billing/webhooks/stripe", content=payload,
        headers={"Stripe-Signature": _signature(payload)},
    )
    assert response.status_code == 400


def test_non_ascii_signature_is_rejected_without_server_error(client, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", _SYNTHETIC_SIGNING_SECRET)
    signature = f"t={int(time.time())},v1=".encode() + b"\xff"
    response = client.post(
        "/api/v1/billing/webhooks/stripe", content=b"{}",
        headers={"Stripe-Signature": signature},
    )
    assert response.status_code == 400

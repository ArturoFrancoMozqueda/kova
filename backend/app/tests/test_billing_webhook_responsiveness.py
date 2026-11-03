"""A blocked synchronous webhook must not block unrelated ASGI requests."""
import asyncio
import hashlib
import hmac
import json
import time
from threading import Event
from uuid import uuid4

import httpx

from app.audit.models import AuditLog
from app.billing import service
from app.billing.models import WebhookEvent
from app.config import settings
from app.main import app
from app.observability.logging import request_id_var


def test_waiting_webhook_keeps_health_responsive_and_preserves_context_and_idempotency(
    db, monkeypatch,
):
    # These Events coordinate requests; timeouts only prevent a broken regression
    # from hanging. No scheduling sleeps or mock threadpool assertions are used.
    entered, release = Event(), Event()
    contexts = []
    process = service.process_stripe_webhook
    signing_secret = "whsec_synthetic_responsiveness"  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_webhook_secret", signing_secret)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    event_id = f"evt_responsiveness_{uuid4().hex}"
    payload = json.dumps({
        "id": event_id, "type": "charge.dispute.created", "livemode": False,
        "created": int(time.time()), "data": {"object": {
            "id": "du_synthetic", "charge": "ch_synthetic", "payment_intent": None,
        }},
    }).encode()
    timestamp = int(time.time())
    digest = hmac.new(signing_secret.encode(), f"{timestamp}.".encode() + payload,
                      hashlib.sha256).hexdigest()
    headers = {"Stripe-Signature": f"t={timestamp},v1={digest}",
               "X-Request-Id": "risk-webhook-responsiveness"}

    def blocked_process(*args, **kwargs):
        contexts.append(request_id_var.get())
        entered.set()
        if not release.wait(timeout=5):
            raise TimeoutError("Concurrent request did not release the webhook")
        # Real signature verification and PostgreSQL work still happen after the
        # gate. The session is only used sequentially, never by the health call.
        return process(*args, **kwargs)

    monkeypatch.setattr(service, "process_stripe_webhook", blocked_process)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        ) as client:
            webhook = asyncio.create_task(client.post(
                "/api/v1/billing/webhooks/stripe", content=payload, headers=headers,
            ))
            try:
                assert await asyncio.to_thread(entered.wait, 2), "Webhook did not start"
                assert not webhook.done()
                health = await asyncio.wait_for(client.get("/health"), timeout=2)
                assert health.status_code == 200
                assert health.json()["status"] == "ok"
                assert not release.is_set()
                assert not webhook.done(), "Health completed only after the webhook"
            finally:
                release.set()
                response = await webhook
            assert response.status_code == 200, response.text
            assert response.json() == {"status": "processed"}
            duplicate = await client.post(
                "/api/v1/billing/webhooks/stripe", content=payload, headers=headers,
            )
            assert duplicate.status_code == 200
            assert duplicate.json() == {"status": "processed"}
            rejected = await client.post(
                "/api/v1/billing/webhooks/stripe", content=payload,
                headers={**headers, "Stripe-Signature": "invalid"},
            )
            assert rejected.status_code == 400

    asyncio.run(exercise())
    assert contexts == ["risk-webhook-responsiveness"] * 3
    row = db.query(WebhookEvent).filter_by(stripe_event_id=event_id).one()
    assert row.processing_status == "processed" and row.process_attempts == 1
    assert db.query(AuditLog).filter_by(resource_id=row.id).count() == 1

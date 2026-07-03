"""Global guard: no ops endpoint may leak secrets into its response.

Sets every secret-bearing setting to a distinctive sentinel, seeds a webhook
carrying card data, hits every GET endpoint as an allowlisted admin, and
asserts none of the sentinels (or obvious secret prefixes/PII) appear anywhere
in the serialized responses.
"""
from datetime import UTC, datetime
from uuid import uuid4

from app.billing.models import WebhookEvent
from app.config import settings
from app.tests.test_ops_auth import _signup_login

ADMIN = "nosecrets-ceo@ops-test.com"

# Distinctive sentinels — if any shows up in a response, a secret leaked.
SENTINELS = {
    "secret_key": "SENTINEL-secret-key-value",
    "stripe_secret_key": "sk_test_SENTINELstripekey",
    "stripe_webhook_secret": "whsec_SENTINEL",
    "internal_api_key": "SENTINEL-internal-key",
    "sentry_api_token": "SENTINEL-sentry-token",
    "fly_api_token": "SENTINEL-fly-token",
    "vercel_api_token": "SENTINEL-vercel-token",
    "uptimerobot_api_key": "SENTINEL-uptimerobot-key",
}


def _endpoints() -> list[str]:
    return [
        "/api/v1/internal/ops/me",
        "/api/v1/internal/ops/overview",
        "/api/v1/internal/ops/technical",
        "/api/v1/internal/ops/revenue",
        "/api/v1/internal/ops/funnel",
        "/api/v1/internal/ops/tenants",
        "/api/v1/internal/ops/incidents",
        "/api/v1/internal/ops/trace?stripe_event_id=evt_secretcheck",
        "/api/v1/internal/ops/notes",
    ]


def test_no_ops_endpoint_leaks_secrets(client, db, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    for field, value in SENTINELS.items():
        monkeypatch.setattr(settings, field, value)
    _signup_login(client, ADMIN, "No Secrets HQ")

    # Seed a webhook whose payload carries card data + PII that must be stripped.
    db.add(
        WebhookEvent(
            id=uuid4(),
            tenant_id=None,
            stripe_event_id="evt_secretcheck",
            event_type="invoice.payment_failed",
            processing_status="failed",
            process_attempts=1,
            error_reason="card_declined",
            payload={
                "id": "evt_secretcheck",
                "data": {
                    "object": {
                        "id": "in_x",
                        "customer": "cus_x",
                        "customer_email": "buyer@example.com",
                        "payment_method_details": {"card": {"number": "4242424242424242"}},
                    }
                },
            },
            created_at=datetime.now(UTC),
        )
    )
    db.flush()

    for url in _endpoints():
        response = client.get(url)
        assert response.status_code == 200, f"{url} -> {response.status_code}"
        body = response.text
        for field, sentinel in SENTINELS.items():
            assert sentinel not in body, f"{field} leaked in {url}"
        # No live/test secret-key prefixes, card data, or customer PII.
        assert "sk_test_" not in body, f"stripe key prefix in {url}"
        assert "whsec_" not in body, f"webhook secret prefix in {url}"
        assert "4242424242424242" not in body, f"card number in {url}"
        assert "payment_method_details" not in body, f"card block in {url}"
        assert "buyer@example.com" not in body, f"customer PII in {url}"

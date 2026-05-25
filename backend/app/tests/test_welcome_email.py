import hashlib
import hmac
import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient

from app.billing import service as billing_service
from app.config import settings
from app.email import service as email_service


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    return signup


def _stripe_signature(payload: bytes, secret: str = "whsec_test_123") -> str:
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    digest = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _checkout_event(tenant_id: str) -> bytes:
    return json.dumps(
        {
            "id": f"evt_{uuid4().hex}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": f"cs_{uuid4().hex}",
                    "object": "checkout.session",
                    "customer": f"cus_{uuid4().hex}",
                    "subscription": f"sub_{uuid4().hex}",
                    "metadata": {"tenant_id": tenant_id},
                }
            },
        },
        separators=(",", ":"),
    ).encode()


def test_checkout_completed_sends_welcome_email_to_owner(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")
    email = f"welcome-{uuid4().hex}@example.com"
    signup = _signup_verify_login(client, email, "Welcome Tenant")

    sent: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_welcome_email",
        lambda *, to: sent.append({"to": to}),
    )
    # Also intercept the same symbol on the billing service module so the patch
    # is effective regardless of import-binding (billing imports the module).
    monkeypatch.setattr(
        billing_service.email_service,
        "send_welcome_email",
        lambda *, to: sent.append({"to": to}),
    )

    payload = _checkout_event(signup["tenant_id"])
    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    assert len(sent) == 1
    assert sent[0]["to"] == email


def test_checkout_completed_with_missing_tenant_does_not_send_welcome(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")

    sent: list[dict] = []
    monkeypatch.setattr(
        billing_service.email_service,
        "send_welcome_email",
        lambda *, to: sent.append({"to": to}),
    )

    payload = json.dumps(
        {
            "id": f"evt_{uuid4().hex}",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": f"cs_{uuid4().hex}",
                    "object": "checkout.session",
                    "subscription": f"sub_{uuid4().hex}",
                    "metadata": {},
                }
            },
        },
        separators=(",", ":"),
    ).encode()
    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    assert sent == []

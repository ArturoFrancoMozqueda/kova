import hashlib
import hmac
import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient

from app.billing import service as billing_service
from app.config import settings
from app.email import service as email_service


def _signup_verify(client: TestClient, email: str, tenant_name: str) -> dict:
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


def _invoice_paid_event(tenant_id: str) -> bytes:
    return json.dumps(
        {
            "id": f"evt_{uuid4().hex}",
            "type": "invoice.payment_succeeded",
            "data": {
                "object": {
                    "id": f"in_{uuid4().hex}",
                    "object": "invoice",
                    "number": "KOVA-0001",
                    "amount_paid": 29900,
                    "currency": "mxn",
                    "hosted_invoice_url": "https://stripe.test/invoice/abc",
                    "period_end": 1_900_000_000,
                    "subscription": f"sub_{uuid4().hex}",
                    "metadata": {"tenant_id": tenant_id},
                }
            },
        },
        separators=(",", ":"),
    ).encode()


def test_invoice_payment_succeeded_sends_receipt(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")
    email = f"receipt-{uuid4().hex}@example.com"
    signup = _signup_verify(client, email, "Receipt Tenant")

    sent: list[dict] = []
    monkeypatch.setattr(
        email_service,
        "send_payment_receipt_email",
        lambda **kwargs: sent.append(kwargs),
    )
    monkeypatch.setattr(
        billing_service.email_service,
        "send_payment_receipt_email",
        lambda **kwargs: sent.append(kwargs),
    )

    payload = _invoice_paid_event(signup["tenant_id"])
    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    assert len(sent) == 1
    call = sent[0]
    assert call["to"] == email
    assert call["amount_minor_units"] == 29900
    assert call["currency"] == "MXN"
    assert call["invoice_number"] == "KOVA-0001"
    assert call["invoice_url"] == "https://stripe.test/invoice/abc"
    assert call["period_end_iso"] is not None

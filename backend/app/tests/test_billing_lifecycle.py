"""Lifecycle convergence for billing (PLAN-01).

Proves that production-realistic Stripe events — which carry *no* checkout
session metadata — still resolve to the correct tenant via the local
subscription row, so local status converges to Stripe's truth (cancellation
removes access). Also covers the checkout payload (tenant metadata + customer
reuse + session-id placeholder) and the live/test webhook-secret boot guard.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qs
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.billing import service as billing_service
from app.billing import stripe_client as stripe_client_module
from app.billing.models import Subscription
from app.billing.stripe_client import StripeCheckoutClient
from app.config import settings


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return signup


def _configure_stripe(monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_standard_299_mxn")


def _stripe_signature(payload: bytes, secret: str = "whsec_test_123") -> str:  # gitleaks:allow
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    digest = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _stripe_event(event_type: str, stripe_object: dict) -> bytes:
    return json.dumps(
        {
            "id": f"evt_{uuid4().hex}",
            "type": event_type,
            "data": {"object": stripe_object},
        },
        separators=(",", ":"),
    ).encode()


def _post_webhook(client: TestClient, payload: bytes):
    return client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )


def test_subscription_deleted_without_metadata_cancels_and_removes_access(
    client: TestClient, db: Session, monkeypatch
) -> None:
    """Production `customer.subscription.deleted` events carry no metadata. The
    handler must resolve the tenant by Stripe subscription id, flip the local
    row to `canceled`, and remove commercial access."""
    _configure_stripe(monkeypatch)
    tenant = _signup_verify_login(
        client, f"lifecycle-cancel-{uuid4().hex}@example.com", "Lifecycle Cancel"
    )
    db.add(
        Subscription(
            tenant_id=UUID(tenant["tenant_id"]),
            stripe_customer_id="cus_lifecycle_cancel",
            stripe_subscription_id="sub_lifecycle_cancel",
            status="active",
        )
    )
    db.commit()

    payload = _stripe_event(
        "customer.subscription.deleted",
        {
            "id": "sub_lifecycle_cancel",
            "object": "subscription",
            "customer": "cus_lifecycle_cancel",
            "status": "canceled",
            # Production-realistic: NO metadata.tenant_id.
            "metadata": {},
        },
    )

    response = _post_webhook(client, payload)
    assert response.status_code == 200, response.text

    subscription = (
        db.query(Subscription)
        .filter(Subscription.tenant_id == UUID(tenant["tenant_id"]))
        .one()
    )
    assert subscription.status == "canceled"

    status = client.get("/api/v1/billing/subscription")
    assert status.status_code == 200, status.text
    assert status.json()["access"]["allowed"] is False


def test_subscription_updated_without_metadata_converges_to_past_due(
    client: TestClient, db: Session, monkeypatch
) -> None:
    """A `customer.subscription.updated` event with no metadata must still
    resolve the tenant and converge the local status (here: past_due)."""
    _configure_stripe(monkeypatch)
    monkeypatch.setattr(settings, "billing_grace_period_days", 4)
    tenant = _signup_verify_login(
        client, f"lifecycle-update-{uuid4().hex}@example.com", "Lifecycle Update"
    )
    db.add(
        Subscription(
            tenant_id=UUID(tenant["tenant_id"]),
            stripe_customer_id="cus_lifecycle_update",
            stripe_subscription_id="sub_lifecycle_update",
            status="active",
        )
    )
    db.commit()

    payload = _stripe_event(
        "customer.subscription.updated",
        {
            "id": "sub_lifecycle_update",
            "object": "subscription",
            "customer": "cus_lifecycle_update",
            "status": "past_due",
            "metadata": {},
        },
    )

    response = _post_webhook(client, payload)
    assert response.status_code == 200, response.text

    subscription = (
        db.query(Subscription)
        .filter(Subscription.tenant_id == UUID(tenant["tenant_id"]))
        .one()
    )
    assert subscription.status == "past_due"
    assert subscription.past_due_at is not None
    assert subscription.grace_period_ends_at is not None


def test_subscription_event_without_matching_row_is_ignored(
    client: TestClient, db: Session, monkeypatch
) -> None:
    """When neither metadata nor a local subscription row resolves the tenant,
    the event is ignored (unchanged safe fallback)."""
    _configure_stripe(monkeypatch)
    payload = _stripe_event(
        "customer.subscription.deleted",
        {
            "id": "sub_unknown_no_row",
            "object": "subscription",
            "customer": "cus_unknown",
            "status": "canceled",
            "metadata": {},
        },
    )

    response = _post_webhook(client, payload)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ignored"


def test_checkout_payload_carries_subscription_metadata_and_reuses_customer(
    monkeypatch,
) -> None:
    """Unit test of the outbound Stripe payload: the created subscription must
    carry the tenant id (so lifecycle events resolve), the customer is reused,
    and the success URL carries the session-id placeholder for reconciliation."""
    captured: dict[str, str] = {}

    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"id":"cs_x","url":"https://checkout.stripe.test/cs_x"}'

    def _fake_urlopen(request, timeout=10):  # noqa: ARG001
        captured["data"] = request.data.decode()
        return _FakeResponse()

    monkeypatch.setattr(stripe_client_module, "urlopen", _fake_urlopen)

    StripeCheckoutClient().create_checkout_session(
        secret_key="sk_test_123",  # gitleaks:allow
        price_id="price_standard_299_mxn",
        success_url="https://app.example.com/billing/success",
        cancel_url="https://app.example.com/billing/cancel",
        tenant_id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        idempotency_key="idem-1",
        customer="cus_existing",
    )

    parsed = parse_qs(captured["data"])
    assert parsed["subscription_data[metadata][tenant_id]"] == [
        "11111111-1111-1111-1111-111111111111"
    ]
    assert parsed["metadata[tenant_id]"] == ["11111111-1111-1111-1111-111111111111"]
    assert parsed["customer"] == ["cus_existing"]
    assert "{CHECKOUT_SESSION_ID}" in parsed["success_url"][0]


def test_checkout_payload_omits_customer_when_absent(monkeypatch) -> None:
    """A first-time checkout has no stored customer, so `customer` must not be
    sent (Stripe would reject an empty value)."""
    captured: dict[str, str] = {}

    class _FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"id":"cs_x","url":"https://checkout.stripe.test/cs_x"}'

    def _fake_urlopen(request, timeout=10):  # noqa: ARG001
        captured["data"] = request.data.decode()
        return _FakeResponse()

    monkeypatch.setattr(stripe_client_module, "urlopen", _fake_urlopen)

    StripeCheckoutClient().create_checkout_session(
        secret_key="sk_test_123",  # gitleaks:allow
        price_id="price_standard_299_mxn",
        success_url="https://app.example.com/billing/success",
        cancel_url="https://app.example.com/billing/cancel",
        tenant_id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        idempotency_key="idem-1",
    )

    parsed = parse_qs(captured["data"])
    assert "customer" not in parsed


def test_live_deployment_rejects_test_mode_webhook_secret(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow

    with pytest.raises(RuntimeError, match="STRIPE_WEBHOOK_SECRET must use live mode"):
        billing_service.validate_webhook_secret_mode()


def test_live_deployment_allows_live_webhook_secret(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_live_abc123")  # gitleaks:allow

    billing_service.validate_webhook_secret_mode()  # must not raise


def test_explicit_test_mode_allows_test_webhook_secret(monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", True)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow

    billing_service.validate_webhook_secret_mode()  # must not raise


def test_boot_fails_with_test_webhook_secret_in_live_deployment(monkeypatch) -> None:
    """Full boot-config integration: a live deployment configured with a
    test-mode webhook secret must refuse to boot with a clear error."""
    from app.main import _validate_config

    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "secret_key", "a-real-long-secret-value-not-the-default")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_live_123")  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    monkeypatch.setattr(settings, "resend_api_key", "re_live_123")
    monkeypatch.setattr(settings, "email_from", "hola@kova.example")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow

    with pytest.raises(RuntimeError, match="STRIPE_WEBHOOK_SECRET must use live mode"):
        _validate_config()

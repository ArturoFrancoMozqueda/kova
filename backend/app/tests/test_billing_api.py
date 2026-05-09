import hashlib
import hmac
import json
import time
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.billing import service as billing_service
from app.billing.models import Subscription, WebhookEvent
from app.config import settings


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
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


def _set_role(db: Session, signup: dict, role: str) -> None:
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = role
    db.commit()


def test_owner_views_standard_plan_without_subscription(client: TestClient) -> None:
    _signup_verify_login(client, f"billing-owner-{uuid4().hex}@example.com", "Billing Owner")

    response = client.get("/api/v1/billing/subscription")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan"] == {
        "name": "Standard Plan",
        "amount_minor_units": 19900,
        "currency": "MXN",
        "interval": "month",
    }
    assert body["subscription"] is None


def test_cashier_cannot_view_billing_subscription(client: TestClient, db: Session) -> None:
    email = f"billing-cashier-{uuid4().hex}@example.com"
    signup = _signup_verify_login(client, email, "Billing Cashier")
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text

    response = client.get("/api/v1/billing/subscription")

    assert response.status_code == 403


def test_billing_subscription_is_tenant_scoped(client: TestClient, db: Session) -> None:
    suffix = uuid4().hex
    tenant_a = _signup_verify_login(client, f"billing-tenant-a-{suffix}@example.com", "Tenant A")
    subscription = Subscription(
        tenant_id=UUID(tenant_a["tenant_id"]),
        stripe_customer_id=f"cus_{suffix}",
        stripe_subscription_id=f"sub_{suffix}",
        stripe_price_id=f"price_{suffix}",
        status="active",
    )
    db.add(subscription)
    db.commit()
    client.post("/api/v1/auth/logout")

    _signup_verify_login(client, f"billing-tenant-b-{suffix}@example.com", "Tenant B")
    tenant_b_response = client.get("/api/v1/billing/subscription")

    assert tenant_b_response.status_code == 200, tenant_b_response.text
    assert tenant_b_response.json()["subscription"] is None

    client.post("/api/v1/auth/logout")
    login_a = client.post(
        "/api/v1/auth/login",
        json={"email": f"billing-tenant-a-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login_a.status_code == 200, login_a.text

    tenant_a_response = client.get("/api/v1/billing/subscription")

    assert tenant_a_response.status_code == 200, tenant_a_response.text
    body = tenant_a_response.json()
    assert body["subscription"]["status"] == "active"
    assert body["subscription"]["tenant_id"] == tenant_a["tenant_id"]


class FakeStripeCheckoutClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create_checkout_session(self, **kwargs) -> dict:
        self.calls.append(kwargs)
        return {
            "id": "cs_test_123",
            "url": "https://checkout.stripe.test/session/cs_test_123",
        }


def _configure_stripe(monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_standard_199_mxn")
    monkeypatch.setattr(
        settings,
        "stripe_checkout_success_url",
        "http://localhost:5173/billing/success",
    )
    monkeypatch.setattr(
        settings,
        "stripe_checkout_cancel_url",
        "http://localhost:5173/billing/cancel",
    )


def test_owner_starts_checkout_session(client: TestClient, db: Session, monkeypatch) -> None:
    fake_client = FakeStripeCheckoutClient()
    monkeypatch.setattr(billing_service, "checkout_client", fake_client)
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(client, f"checkout-owner-{uuid4().hex}@example.com", "Checkout")

    response = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "checkout-start-1"},
    )

    assert response.status_code == 201, response.text
    assert response.json() == {
        "checkout_url": "https://checkout.stripe.test/session/cs_test_123",
        "checkout_session_id": "cs_test_123",
    }
    assert fake_client.calls[0]["tenant_id"] == signup["tenant_id"]
    assert fake_client.calls[0]["price_id"] == "price_standard_199_mxn"

    audit = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "billing.checkout_started",
        )
        .one()
    )
    assert audit.changes["checkout_session_id"] == "cs_test_123"


def test_checkout_replays_idempotent_response_without_duplicate_audit(
    client: TestClient, db: Session, monkeypatch
) -> None:
    fake_client = FakeStripeCheckoutClient()
    monkeypatch.setattr(billing_service, "checkout_client", fake_client)
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(
        client, f"checkout-replay-{uuid4().hex}@example.com", "Checkout Replay"
    )

    first = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "checkout-replay"},
    )
    second = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "checkout-replay"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()
    assert len(fake_client.calls) == 1
    audit_count = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "billing.checkout_started",
        )
        .count()
    )
    assert audit_count == 1


def test_checkout_requires_stripe_configuration(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    monkeypatch.setattr(settings, "stripe_standard_price_id", None)
    monkeypatch.setattr(settings, "stripe_checkout_success_url", None)
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", None)
    _signup_verify_login(client, f"checkout-config-{uuid4().hex}@example.com", "Checkout Config")

    response = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "checkout-missing-config"},
    )

    assert response.status_code == 503


def test_cashier_cannot_start_checkout(client: TestClient, db: Session, monkeypatch) -> None:
    _configure_stripe(monkeypatch)
    email = f"checkout-cashier-{uuid4().hex}@example.com"
    signup = _signup_verify_login(client, email, "Checkout Cashier")
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text

    response = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "checkout-cashier"},
    )

    assert response.status_code == 403


def test_checkout_requires_idempotency_key(client: TestClient, monkeypatch) -> None:
    _configure_stripe(monkeypatch)
    _signup_verify_login(client, f"checkout-key-{uuid4().hex}@example.com", "Checkout Key")

    response = client.post("/api/v1/billing/checkout")

    assert response.status_code == 400


def _stripe_signature(payload: bytes, secret: str = "whsec_test_123") -> str:
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


def test_stripe_webhook_rejects_invalid_signature(client: TestClient, monkeypatch) -> None:
    _configure_stripe(monkeypatch)
    payload = _stripe_event("checkout.session.completed", {"metadata": {}})

    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": "t=1,v1=bad"},
    )

    assert response.status_code == 400


def test_checkout_completed_webhook_activates_subscription_idempotently(
    client: TestClient, db: Session, monkeypatch
) -> None:
    _configure_stripe(monkeypatch)
    tenant = _signup_verify_login(
        client, f"webhook-checkout-{uuid4().hex}@example.com", "Webhook Checkout"
    )
    payload = _stripe_event(
        "checkout.session.completed",
        {
            "id": "cs_test_completed",
            "object": "checkout.session",
            "customer": "cus_test_completed",
            "subscription": "sub_test_completed",
            "metadata": {"tenant_id": tenant["tenant_id"]},
        },
    )
    headers = {"Stripe-Signature": _stripe_signature(payload)}

    first = client.post("/api/v1/billing/webhooks/stripe", content=payload, headers=headers)
    second = client.post("/api/v1/billing/webhooks/stripe", content=payload, headers=headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    subscription = (
        db.query(Subscription)
        .filter(Subscription.tenant_id == UUID(tenant["tenant_id"]))
        .one()
    )
    assert subscription.status == "active"
    assert subscription.stripe_subscription_id == "sub_test_completed"
    assert subscription.latest_checkout_session_id == "cs_test_completed"
    webhook_events = (
        db.query(WebhookEvent)
        .filter(WebhookEvent.stripe_event_id == json.loads(payload)["id"])
        .all()
    )
    assert len(webhook_events) == 1
    audit_count = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(tenant["tenant_id"]),
            AuditLog.action == "billing.subscription_activated",
        )
        .count()
    )
    assert audit_count == 1


def test_subscription_updated_webhook_updates_status(client: TestClient, db: Session, monkeypatch) -> None:
    _configure_stripe(monkeypatch)
    tenant = _signup_verify_login(
        client, f"webhook-subscription-{uuid4().hex}@example.com", "Webhook Subscription"
    )
    payload = _stripe_event(
        "customer.subscription.updated",
        {
            "id": "sub_test_updated",
            "object": "subscription",
            "customer": "cus_test_updated",
            "status": "trialing",
            "current_period_start": 1_700_000_000,
            "current_period_end": 1_702_592_000,
            "trial_end": 1_700_086_400,
            "cancel_at_period_end": False,
            "metadata": {"tenant_id": tenant["tenant_id"]},
            "items": {
                "data": [
                    {
                        "price": {
                            "id": "price_standard_199_mxn",
                            "unit_amount": 19900,
                            "currency": "mxn",
                        }
                    }
                ]
            },
        },
    )

    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    subscription = (
        db.query(Subscription)
        .filter(Subscription.tenant_id == UUID(tenant["tenant_id"]))
        .one()
    )
    assert subscription.status == "trialing"
    assert subscription.stripe_price_id == "price_standard_199_mxn"
    assert subscription.currency == "MXN"
    assert subscription.amount_minor_units == 19900


def test_invoice_payment_failed_marks_subscription_past_due(
    client: TestClient, db: Session, monkeypatch
) -> None:
    _configure_stripe(monkeypatch)
    tenant = _signup_verify_login(
        client, f"webhook-invoice-{uuid4().hex}@example.com", "Webhook Invoice"
    )
    subscription = Subscription(
        tenant_id=UUID(tenant["tenant_id"]),
        stripe_subscription_id="sub_test_invoice",
        status="active",
    )
    db.add(subscription)
    db.commit()
    payload = _stripe_event(
        "invoice.payment_failed",
        {
            "id": "in_test_failed",
            "object": "invoice",
            "subscription": "sub_test_invoice",
            "metadata": {},
        },
    )

    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    db.refresh(subscription)
    assert subscription.status == "past_due"
    assert subscription.past_due_at is not None


def test_webhook_without_tenant_is_ignored(client: TestClient, db: Session, monkeypatch) -> None:
    _configure_stripe(monkeypatch)
    payload = _stripe_event(
        "checkout.session.completed",
        {
            "id": "cs_no_tenant",
            "object": "checkout.session",
            "subscription": "sub_no_tenant",
            "metadata": {},
        },
    )

    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )

    assert response.status_code == 200, response.text
    event = db.query(WebhookEvent).filter(WebhookEvent.stripe_event_id == json.loads(payload)["id"]).one()
    assert event.processing_status == "ignored"

from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.billing import service as billing_service
from app.billing.models import Subscription
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

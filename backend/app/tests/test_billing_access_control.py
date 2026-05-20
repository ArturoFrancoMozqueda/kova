from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
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


def _create_product(client: TestClient, *, name: str = "Concha") -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"product-{name}-{uuid4().hex}"},
        json={"name": name, "price_amount": "18.50", "track_inventory": False},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_cash_order(client: TestClient, product_id: str):
    return client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"order-{uuid4().hex}"},
        json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "37.00", "amount_tendered": "40.00"}],
        },
    )


class FakeStripeCheckoutClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create_checkout_session(self, **kwargs) -> dict:
        self.calls.append(kwargs)
        return {
            "id": "cs_test_recovery",
            "url": "https://checkout.stripe.test/session/cs_test_recovery",
        }


class FakeStripePriceClient:
    def retrieve_price(self, **kwargs) -> dict:  # noqa: ARG002
        return {
            "id": "price_standard_299_mxn",
            "active": True,
            "unit_amount": 29900,
            "currency": "mxn",
            "recurring": {"interval": "month"},
        }


def _expire_trial(monkeypatch) -> None:
    monkeypatch.setattr(settings, "billing_trial_days", -1)


def test_signup_trial_allows_order_creation(client: TestClient) -> None:
    _signup_verify_login(client, f"trial-open-{uuid4().hex}@example.com", "Trial Open")
    product = _create_product(client)

    response = _create_cash_order(client, product["id"])

    assert response.status_code == 201, response.text


def test_expired_trial_blocks_order_creation_and_audits(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify_login(client, f"trial-expired-{uuid4().hex}@example.com", "Expired")
    product = _create_product(client)
    _expire_trial(monkeypatch)

    response = _create_cash_order(client, product["id"])

    assert response.status_code == 402, response.text
    detail = response.json()["detail"]
    assert detail["reason"] == "trial_expired"
    assert detail["recovery_path"] == "/settings/billing"

    audit = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "billing.access_blocked",
        )
        .one()
    )
    assert audit.changes["path"] == "/api/v1/orders"
    assert audit.changes["reason"] == "trial_expired"


def test_active_subscription_allows_order_after_trial_expiry(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify_login(client, f"sub-active-{uuid4().hex}@example.com", "Active")
    _expire_trial(monkeypatch)
    db.add(
        Subscription(
            tenant_id=UUID(signup["tenant_id"]),
            stripe_customer_id=f"cus_{uuid4().hex}",
            stripe_subscription_id=f"sub_{uuid4().hex}",
            stripe_price_id="price_standard_299_mxn",
            status="active",
        )
    )
    db.commit()
    product = _create_product(client)

    response = _create_cash_order(client, product["id"])

    assert response.status_code == 201, response.text


def test_blocked_tenant_can_start_billing_recovery(
    client: TestClient, monkeypatch
) -> None:
    _signup_verify_login(client, f"recovery-{uuid4().hex}@example.com", "Recovery")
    _expire_trial(monkeypatch)
    fake_checkout = FakeStripeCheckoutClient()
    monkeypatch.setattr(billing_service, "checkout_client", fake_checkout)
    monkeypatch.setattr(billing_service, "price_client", FakeStripePriceClient())
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_standard_299_mxn")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "http://localhost/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "http://localhost/cancel")

    response = client.post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": f"checkout-{uuid4().hex}"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["checkout_session_id"] == "cs_test_recovery"

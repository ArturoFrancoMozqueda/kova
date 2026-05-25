from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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


def _billing_step(state: dict) -> dict:
    return next(step for step in state["steps"] if step["key"] == "billing")


def _expire_trial(monkeypatch) -> None:
    monkeypatch.setattr(settings, "billing_trial_days", -1)


def test_onboarding_billing_complete_for_active_subscription(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify_login(client, f"ob-active-{uuid4().hex}@example.com", "Active")
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

    response = client.get("/api/v1/onboarding/state")
    assert response.status_code == 200, response.text
    assert _billing_step(response.json())["completed"] is True


def test_onboarding_billing_complete_for_trialing_subscription(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify_login(client, f"ob-trialing-{uuid4().hex}@example.com", "Trialing")
    _expire_trial(monkeypatch)
    db.add(
        Subscription(
            tenant_id=UUID(signup["tenant_id"]),
            stripe_customer_id=f"cus_{uuid4().hex}",
            stripe_subscription_id=f"sub_{uuid4().hex}",
            stripe_price_id="price_standard_299_mxn",
            status="trialing",
            trial_ends_at=datetime.now(UTC) + timedelta(days=10),
        )
    )
    db.commit()

    response = client.get("/api/v1/onboarding/state")
    assert response.status_code == 200, response.text
    assert _billing_step(response.json())["completed"] is True


def test_onboarding_billing_complete_for_past_due_within_grace(
    client: TestClient, db: Session, monkeypatch
) -> None:
    signup = _signup_verify_login(client, f"ob-grace-{uuid4().hex}@example.com", "Grace")
    _expire_trial(monkeypatch)
    db.add(
        Subscription(
            tenant_id=UUID(signup["tenant_id"]),
            stripe_customer_id=f"cus_{uuid4().hex}",
            stripe_subscription_id=f"sub_{uuid4().hex}",
            stripe_price_id="price_standard_299_mxn",
            status="past_due",
            past_due_at=datetime.now(UTC),
            grace_period_ends_at=datetime.now(UTC) + timedelta(days=3),
        )
    )
    db.commit()

    response = client.get("/api/v1/onboarding/state")
    assert response.status_code == 200, response.text
    assert _billing_step(response.json())["completed"] is True


def test_onboarding_billing_incomplete_during_signup_trial(client: TestClient) -> None:
    _signup_verify_login(client, f"ob-signup-trial-{uuid4().hex}@example.com", "Signup Trial")

    response = client.get("/api/v1/onboarding/state")
    assert response.status_code == 200, response.text
    # Signup trial grants access but the user still hasn't activated a plan,
    # so the checklist must keep prompting them to do so.
    assert _billing_step(response.json())["completed"] is False


def test_onboarding_billing_incomplete_when_trial_expired(
    client: TestClient, monkeypatch
) -> None:
    _signup_verify_login(client, f"ob-expired-{uuid4().hex}@example.com", "Expired")
    _expire_trial(monkeypatch)

    response = client.get("/api/v1/onboarding/state")
    assert response.status_code == 200, response.text
    assert _billing_step(response.json())["completed"] is False

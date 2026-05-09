from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.billing.models import Subscription


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

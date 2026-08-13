from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.tenants.feature_flags import resolve_feature_flags
from app.tenants.models import Tenant


def _signup_verify_login(client) -> UUID:
    email = f"feature-flags-{uuid4().hex}@example.com"
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": "Feature Flags Tenant",
            "accepted_terms": True,
        },
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post(
        "/api/v1/auth/verify", json={"token": signup["dev_verification_token"]}
    )
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return UUID(signup["tenant_id"])


def test_session_exposes_supported_tenant_override(client, db: Session) -> None:
    tenant_id = _signup_verify_login(client)
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).one()
    tenant.feature_overrides = {
        "margin_reports": True,
        "customer_orders": False,
        "unknown_flag": True,
        "not_a_boolean": "true",
    }
    db.commit()

    response = client.get("/api/v1/auth/session")

    assert response.status_code == 200, response.text
    assert response.json()["feature_flags"] == {
        "margin_reports": True,
        "customer_orders": False,
    }


def test_session_uses_global_feature_defaults(client) -> None:
    _signup_verify_login(client)

    response = client.get("/api/v1/auth/session")

    assert response.status_code == 200, response.text
    assert response.json()["feature_flags"] == {
        "margin_reports": False,
        "customer_orders": True,
    }


def test_non_boolean_override_does_not_enable_feature() -> None:
    assert resolve_feature_flags({"margin_reports": "true"}) == {
        "margin_reports": False,
        "customer_orders": True,
    }

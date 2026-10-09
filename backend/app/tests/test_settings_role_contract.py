from uuid import UUID, uuid4

import pytest

from app.auth.models import Membership

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.mark.parametrize("role,write_status", [("manager", 200), ("cashier", 403)])
def test_settings_role_contract_keeps_employee_data_owner_only(client, db, role, write_status):
    email = f"settings-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": "Settings Role", "accepted_terms": True},
    )
    assert signup.status_code == 201
    body = signup.json()
    assert client.post("/api/v1/auth/verify", json={"token": body["dev_verification_token"]}).status_code == 200
    membership = db.query(Membership).filter(Membership.user_id == UUID(body["user_id"])).one()
    membership.role = role
    db.commit()
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}).status_code == 200

    assert client.get("/api/v1/settings/business-profile").status_code == 200
    assert client.get("/api/v1/settings/receipt").status_code == 200
    assert client.put(
        "/api/v1/settings/business-profile",
        json={"public_name": "Settings Role", "timezone": "America/Tijuana", "locale": "es-MX", "currency": "MXN"},
    ).status_code == write_status
    assert client.put(
        "/api/v1/settings/receipt",
        json={"receipt_business_name": "Settings Role", "paper_width_mm": 58},
    ).status_code == write_status
    assert client.get("/api/v1/employees").status_code == 403
    assert client.get("/api/v1/employees/invitations").status_code == 403
    assert client.get("/api/v1/billing/subscription").status_code == 403

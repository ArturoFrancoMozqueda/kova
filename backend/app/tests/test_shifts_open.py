"""D7 — at most one open shift per tenant.

The app-level "is one already open?" check is a fast path; the partial unique
index uq_one_open_shift_per_tenant is the real backstop against a concurrent
double-open, which the service maps to a 409.
"""
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.shifts.models import Shift


def _signup_verify_login(client, email: str, tenant_name: str) -> dict:
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


def _open_shift(client):
    return client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"open-shift-{uuid4().hex}"},
        json={"opening_cash_amount": "100.00"},
    )


def test_second_open_shift_via_api_is_rejected(client):
    _signup_verify_login(client, f"one-shift-{uuid4().hex}@example.com", "One Shift Tenant")

    assert _open_shift(client).status_code == 201
    second = _open_shift(client)

    assert second.status_code == 400, second.text


def test_db_rejects_a_second_open_shift(client, db):
    signup = _signup_verify_login(client, f"one-shift-db-{uuid4().hex}@example.com", "DB Shift Tenant")
    assert _open_shift(client).status_code == 201

    # Bypass the app check and insert a second open shift directly: the partial
    # unique index must reject it. This is the invariant a concurrent race would
    # otherwise slip past.
    duplicate = Shift(tenant_id=UUID(signup["tenant_id"]), status="open")
    db.add(duplicate)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

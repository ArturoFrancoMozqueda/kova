import pytest
from fastapi import HTTPException

from app.auth import service
from app.tests.test_auth import signup_and_login

# ASCII and accented passwords can satisfy the old 128-character limit while
# exceeding bcrypt's 72-byte boundary.
OVERSIZED_PASSWORDS = ["A1" + "x" * 71, "A1" + "ñ" * 36]


@pytest.mark.parametrize("password", OVERSIZED_PASSWORDS)
@pytest.mark.parametrize("flow", ["signup", "reset", "invitation"])
def test_password_creation_rejects_oversized_utf8_before_processing(client, password, flow):
    if flow == "signup":
        path = "/api/v1/auth/signup"
        body = {
            "email": "oversized@example.com",
            "password": password,
            "tenant_name": "Byte limit",
            "accepted_terms": True,
        }
    elif flow == "reset":
        path = "/api/v1/auth/password-reset/confirm"
        body = {"token": "unused", "new_password": password}
    else:
        path = "/api/v1/employees/invitations/accept"
        body = {"token": "unused", "password": password}

    response = client.post(path, json=body)
    assert response.status_code == 422
    assert "72 bytes" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("password", OVERSIZED_PASSWORDS)
def test_long_login_input_returns_identical_invalid_credentials(client, password):
    signup_and_login(client)
    known = client.post(
        "/api/v1/auth/login", json={"email": "owner@example.com", "password": password}
    )
    unknown = client.post(
        "/api/v1/auth/login", json={"email": "unknown@example.com", "password": password}
    )
    assert known.status_code == unknown.status_code == 401
    assert known.json() == unknown.json()


@pytest.mark.parametrize("password", ["A1" + "x" * 70, "A1" + "ñ" * 35])
def test_password_at_exact_utf8_byte_boundary_hashes_and_verifies(password):
    assert len(password.encode()) == 72
    hashed = service.hash_password(password)
    assert service.verify_password(password, hashed)
    assert not service.verify_password(password + "x", hashed)


def test_internal_password_creation_rejects_oversized_input():
    with pytest.raises(HTTPException) as exc:
        service.hash_password(OVERSIZED_PASSWORDS[0])
    assert exc.value.status_code == 400

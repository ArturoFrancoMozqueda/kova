from datetime import UTC, datetime, timedelta

import pyotp
from sqlalchemy import text

from app.config import settings
from app.tests.test_ops_auth import PASSWORD, _signup_login

ADMIN = "mfa-founder@ops-test.com"


def _enrollment_key() -> str:
    assert settings.internal_ops_mfa_enrollment_key is not None
    return settings.internal_ops_mfa_enrollment_key.get_secret_value()


def _start_enrollment(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "MFA HQ", enroll_mfa=False)
    setup = client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={"password": PASSWORD, "enrollment_key": _enrollment_key()},
    )
    assert setup.status_code == 200
    assert setup.headers["cache-control"] == "private, no-store, max-age=0"
    assert setup.headers["pragma"] == "no-cache"
    assert settings.internal_ops_mfa_root_key is not None
    assert settings.internal_ops_mfa_root_key.get_secret_value() not in setup.text
    body = setup.json()
    assert body["qr_png_data_url"].startswith("data:image/png;base64,")
    return body["secret"]


def _confirm(client, secret: str):
    response = client.post(
        "/api/v1/internal/ops/mfa/confirm",
        json={
            "password": PASSWORD,
            "enrollment_key": _enrollment_key(),
            "code": pyotp.TOTP(secret).now(),
        },
    )
    assert response.status_code == 200
    return response.json()["recovery_codes"]


def test_founder_must_enroll_before_ops_access(client, monkeypatch):
    _start_enrollment(client, monkeypatch)

    blocked = client.get("/api/v1/internal/ops/me")

    assert blocked.status_code == 428
    assert blocked.json()["detail"] == "MFA_REQUIRED"
    assert client.get("/api/v1/internal/ops/mfa/status").json() == {
        "enrolled": False,
        "step_up_valid": False,
        "recovery_codes_remaining": 0,
    }


def test_enrollment_requires_current_password(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "MFA Password HQ", enroll_mfa=False)

    response = client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={
            "password": "incorrect-password",
            "enrollment_key": _enrollment_key(),
        },
    )

    assert response.status_code == 403
    assert "secret" not in response.text.lower()


def test_enrollment_requires_out_of_band_key(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "MFA Bootstrap HQ", enroll_mfa=False)

    response = client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={"password": PASSWORD, "enrollment_key": "x" * 32},
    )

    assert response.status_code == 403
    assert "secret" not in response.text.lower()


def test_confirm_cannot_bypass_out_of_band_key(client, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)

    response = client.post(
        "/api/v1/internal/ops/mfa/confirm",
        json={
            "password": PASSWORD,
            "enrollment_key": "wrong-enrollment-key-value-123456",
            "code": pyotp.TOTP(secret).now(),
        },
    )

    assert response.status_code == 403
    assert client.get("/api/v1/internal/ops/mfa/status").json()["enrolled"] is False


def test_unicode_enrollment_key_fails_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "MFA Unicode HQ", enroll_mfa=False)

    response = client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={"password": PASSWORD, "enrollment_key": "🔥" * 32},
    )

    assert response.status_code == 403


def test_enrollment_rejects_untrusted_origin(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "MFA Origin HQ", enroll_mfa=False)

    response = client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={"password": PASSWORD, "enrollment_key": _enrollment_key()},
        headers={"origin": "https://evil.example"},
    )

    assert response.status_code == 403
    assert "secret" not in response.text.lower()


def test_confirm_enables_ops_and_issues_one_time_recovery_codes(client, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)

    recovery_codes = _confirm(client, secret)

    assert len(recovery_codes) == 10
    assert len(set(recovery_codes)) == 10
    assert all(code.startswith("KOVA-") for code in recovery_codes)
    assert client.get("/api/v1/internal/ops/me").status_code == 200
    status = client.get("/api/v1/internal/ops/mfa/status").json()
    assert status["enrolled"] is True
    assert status["step_up_valid"] is True
    assert status["recovery_codes_remaining"] == 10


def test_totp_code_cannot_be_replayed(client, db, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)
    code = pyotp.TOTP(secret).now()
    response = client.post(
        "/api/v1/internal/ops/mfa/confirm",
        json={"password": PASSWORD, "enrollment_key": _enrollment_key(), "code": code},
    )
    assert response.status_code == 200
    db.execute(text("UPDATE sessions SET ops_mfa_verified_at = NULL"))

    replay = client.post("/api/v1/internal/ops/mfa/verify", json={"code": code})

    assert replay.status_code == 403
    assert client.get("/api/v1/internal/ops/me").status_code == 428


def test_recovery_code_is_consumed_once(client, db, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)
    recovery_code = _confirm(client, secret)[0]
    db.execute(text("UPDATE sessions SET ops_mfa_verified_at = NULL"))

    first = client.post(
        "/api/v1/internal/ops/mfa/verify",
        json={"code": recovery_code.lower()},
    )
    assert first.status_code == 200
    assert first.json()["used_recovery_code"] is True
    db.execute(text("UPDATE sessions SET ops_mfa_verified_at = NULL"))

    replay = client.post(
        "/api/v1/internal/ops/mfa/verify",
        json={"code": recovery_code},
    )
    assert replay.status_code == 403


def test_unicode_recovery_input_fails_closed(client, db, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)
    _confirm(client, secret)
    db.execute(text("UPDATE sessions SET ops_mfa_verified_at = NULL"))

    response = client.post(
        "/api/v1/internal/ops/mfa/verify",
        json={"code": "🔥🔥🔥🔥🔥🔥"},
    )

    assert response.status_code == 403


def test_expired_step_up_requires_another_code(client, db, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)
    _confirm(client, secret)
    expired = datetime.now(UTC) - timedelta(hours=2)
    db.execute(
        text("UPDATE sessions SET ops_mfa_verified_at = :expired"),
        {"expired": expired},
    )

    assert client.get("/api/v1/internal/ops/me").status_code == 428


def test_new_login_session_does_not_inherit_step_up(client, monkeypatch):
    secret = _start_enrollment(client, monkeypatch)
    _confirm(client, secret)
    assert client.get("/api/v1/internal/ops/me").status_code == 200

    login = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN, "password": PASSWORD},
    )

    assert login.status_code == 200
    assert client.get("/api/v1/internal/ops/me").status_code == 428


def test_non_founder_cannot_reach_mfa_enrollment(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", "different@ops-test.com")
    _signup_login(client, "normal-mfa@ops-test.com", "Normal MFA")

    assert client.get("/api/v1/internal/ops/mfa/status").status_code == 403
    assert client.post(
        "/api/v1/internal/ops/mfa/setup",
        json={"password": PASSWORD, "enrollment_key": _enrollment_key()},
    ).status_code == 403
    assert client.post(
        "/api/v1/internal/ops/mfa/confirm",
        json={
            "password": PASSWORD,
            "enrollment_key": _enrollment_key(),
            "code": "123456",
        },
    ).status_code == 403
    assert client.post(
        "/api/v1/internal/ops/mfa/verify",
        json={"code": "123456"},
    ).status_code == 403

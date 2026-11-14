"""Account-takeover guards: invitation pre-hijack, failure-only login lockout,
deterministic login tenant and trusted client IP on audit/consent records."""

from datetime import UTC, datetime, timedelta
from itertools import count
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.audit.models import AuditLog
from app.auth import repository as auth_repo
from app.auth import service as auth_service
from app.auth.models import Membership, User, UserSession
from app.config import settings
from app.employees import service as employees_service
from app.employees.schemas import InvitationCreate
from app.middleware import rate_limit as rl

PASSWORD = "S3cur3pass!"
_ip_counter = count(1)


def _signup(client: TestClient, email: str, tenant: str) -> dict:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": PASSWORD, "tenant_name": tenant, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(client: TestClient, email: str, password: str = PASSWORD, ip: str | None = None):
    headers = {settings.trusted_client_ip_header: ip} if ip else None
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}, headers=headers
    )


def _invite(db, monkeypatch, *, tenant_id: UUID, inviter_id: UUID, email: str) -> str:
    token = f"invite-{uuid4().hex}"
    monkeypatch.setattr(employees_service, "_generate_token", lambda: token)
    employees_service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=inviter_id,
        actor_role="owner",
        body=InvitationCreate(email=email, role="cashier"),
    )
    db.commit()
    return token


# ── Invitation pre-hijack ─────────────────────────────────────────────────────


def test_invitation_reclaims_unverified_squatter_account(client, db, monkeypatch):
    victim_email = f"victim-{uuid4().hex}@example.com"

    # Attacker registers the victim's address first and keeps a live session.
    squatter = _signup(client, victim_email, "Negocio Ocupado")
    assert _login(client, victim_email).status_code == 200
    squatter_cookies = {
        name: client.cookies.get(name) for name in ("access_token", "refresh_token", "csrf_token")
    }
    assert all(squatter_cookies.values())
    client.cookies.clear()

    # A real business invites the victim.
    owner_email = f"owner-{uuid4().hex}@example.com"
    owner = _signup(client, owner_email, "Negocio Real")
    client.cookies.clear()
    token = _invite(
        db,
        monkeypatch,
        tenant_id=UUID(owner["tenant_id"]),
        inviter_id=UUID(owner["user_id"]),
        email=victim_email,
    )

    preview = client.get("/api/v1/employees/invitations/preview", params={"token": token})
    assert preview.status_code == 200, preview.text
    assert preview.json()["requires_password"] is True

    # Accepting must not silently attach the membership to the squatter's
    # password: a new password is mandatory.
    missing = client.post(
        "/api/v1/employees/invitations/accept", json={"token": token, "password": None}
    )
    assert missing.status_code == 400, missing.text
    user = db.query(User).filter(User.email == victim_email).one()
    assert (
        db.query(Membership)
        .filter(Membership.user_id == user.id, Membership.tenant_id == UUID(owner["tenant_id"]))
        .count()
        == 0
    )

    new_password = "Nuev0-pass-del-invitado"
    accepted = client.post(
        "/api/v1/employees/invitations/accept",
        json={"token": token, "password": new_password},
    )
    assert accepted.status_code == 200, accepted.text

    db.expire_all()
    user = db.query(User).filter(User.email == victim_email).one()
    assert user.is_email_verified is True
    assert user.id == UUID(squatter["user_id"])
    sessions = db.query(UserSession).filter(UserSession.user_id == user.id).all()
    assert sessions and all(s.revoked_at is not None for s in sessions)
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.action == "employee.invitation_accepted", AuditLog.user_id == user.id)
        .one()
    )
    assert audit.changes == {"account_reclaimed": True}

    # The squatter's password and live tokens are dead.
    assert _login(client, victim_email, PASSWORD).status_code == 401
    client.cookies.clear()
    client.cookies.set("access_token", squatter_cookies["access_token"])
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.clear()
    client.cookies.set("refresh_token", squatter_cookies["refresh_token"])
    client.cookies.set("csrf_token", squatter_cookies["csrf_token"])
    assert client.post("/api/v1/auth/refresh").status_code == 401
    client.cookies.clear()

    # The invitee signs in with the password they chose.
    assert _login(client, victim_email, new_password).status_code == 200


def test_invitation_for_verified_account_keeps_password_and_sessions(client, db, monkeypatch):
    employee_email = f"employee-{uuid4().hex}@example.com"
    employee = _signup(client, employee_email, "Negocio Propio")
    user = db.get(User, UUID(employee["user_id"]))
    auth_repo.set_email_verified(db, user)
    db.commit()
    assert _login(client, employee_email).status_code == 200
    client.cookies.clear()

    owner = _signup(client, f"owner-{uuid4().hex}@example.com", "Negocio Invita")
    client.cookies.clear()
    token = _invite(
        db,
        monkeypatch,
        tenant_id=UUID(owner["tenant_id"]),
        inviter_id=UUID(owner["user_id"]),
        email=employee_email,
    )
    preview = client.get("/api/v1/employees/invitations/preview", params={"token": token})
    assert preview.json()["requires_password"] is False

    accepted = client.post(
        "/api/v1/employees/invitations/accept", json={"token": token, "password": None}
    )
    assert accepted.status_code == 200, accepted.text
    db.expire_all()
    sessions = db.query(UserSession).filter(UserSession.user_id == user.id).all()
    assert sessions and all(s.revoked_at is None for s in sessions)
    assert _login(client, employee_email).status_code == 200


# ── Deterministic login tenant ────────────────────────────────────────────────


def test_membership_by_user_is_the_oldest_active_membership(client, db):
    first = _signup(client, f"multi-{uuid4().hex}@example.com", "Primer Negocio")
    second = _signup(client, f"other-{uuid4().hex}@example.com", "Segundo Negocio")
    user_id = UUID(first["user_id"])
    newer = auth_repo.create_membership(
        db, tenant_id=UUID(second["tenant_id"]), user_id=user_id, role="cashier"
    )
    original = (
        db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.tenant_id == UUID(first["tenant_id"]))
        .one()
    )
    original.created_at = datetime.now(UTC) - timedelta(days=30)
    newer.created_at = datetime.now(UTC)
    db.commit()

    for _ in range(3):
        picked = auth_repo.get_membership_by_user(db, user_id)
        assert picked is not None and picked.tenant_id == UUID(first["tenant_id"])

    original.is_active = False
    db.commit()
    assert auth_repo.get_membership_by_user(db, user_id).tenant_id == UUID(second["tenant_id"])


# ── Failure-only login lockout ────────────────────────────────────────────────


@pytest.fixture
def enforced_limits(monkeypatch):
    """Run with production-like limits (the suite defaults to APP_ENV=local,
    where limiters are no-ops). Each request gets its own trusted client IP so
    the per-IP limit stays out of the way of the per-account behavior."""
    rl._reset_backend_for_tests()
    monkeypatch.setattr(settings, "app_env", "ci")
    yield lambda: f"198.51.100.{next(_ip_counter) % 250 + 1}"
    rl._reset_backend_for_tests()


def test_successful_logins_do_not_consume_the_account_budget(client, enforced_limits):
    email = f"busy-owner-{uuid4().hex}@example.com"
    # Signup outside the enforced window; the fixture's monkeypatch restores env.
    settings.app_env = "local"
    _signup(client, email, "Caja Ocupada")
    settings.app_env = "ci"

    for _ in range(auth_service.LOGIN_FAILURE_LIMIT + 2):
        assert _login(client, email, ip=enforced_limits()).status_code == 200
    # A wrong password after many successes is a plain 401, not a lockout.
    assert _login(client, email, "wrong-password", ip=enforced_limits()).status_code == 401


def test_failures_lock_the_account_until_window_and_success_resets_streak(
    client, enforced_limits
):
    email = f"target-{uuid4().hex}@example.com"
    settings.app_env = "local"
    _signup(client, email, "Negocio Objetivo")
    settings.app_env = "ci"

    limit = auth_service.LOGIN_FAILURE_LIMIT
    for _ in range(limit - 1):
        assert _login(client, email, "wrong-password", ip=enforced_limits()).status_code == 401
    # The owner's success closes the streak before the limit is reached.
    assert _login(client, email, ip=enforced_limits()).status_code == 200

    for _ in range(limit):
        assert _login(client, email, "wrong-password", ip=enforced_limits()).status_code == 401
    locked = _login(client, email, ip=enforced_limits())
    assert locked.status_code == 429, locked.text
    assert 1 <= int(locked.headers["Retry-After"]) <= auth_service.LOGIN_FAILURE_WINDOW_SECONDS + 1


def test_unknown_account_is_locked_like_a_real_one(client, enforced_limits):
    email = f"nobody-{uuid4().hex}@example.com"
    for _ in range(auth_service.LOGIN_FAILURE_LIMIT):
        assert _login(client, email, "wrong-password", ip=enforced_limits()).status_code == 401
    assert _login(client, email, "wrong-password", ip=enforced_limits()).status_code == 429


# ── Trusted client IP on audit and consent ────────────────────────────────────


def test_login_and_signup_record_trusted_client_ip_not_proxy(client, db):
    email = f"ip-{uuid4().hex}@example.com"
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": PASSWORD, "tenant_name": "IP", "accepted_terms": True},
        headers={settings.trusted_client_ip_header: "203.0.113.7"},
    )
    assert r.status_code == 201, r.text
    user = db.get(User, UUID(r.json()["user_id"]))
    assert user.terms_accepted_ip == "203.0.113.7"

    assert _login(client, email, ip="203.0.113.8").status_code == 200
    entry = (
        db.query(AuditLog)
        .filter(AuditLog.action == "user.login", AuditLog.user_id == user.id)
        .one()
    )
    assert entry.ip_address == "203.0.113.8"

    # An arbitrary forwarding header is not trusted.
    client.cookies.clear()
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": PASSWORD},
            headers={"X-Forwarded-For": "192.0.2.99"},
        ).status_code
        == 200
    )
    ips = {
        row.ip_address
        for row in db.query(AuditLog).filter(
            AuditLog.action == "user.login", AuditLog.user_id == user.id
        )
    }
    assert "192.0.2.99" not in ips

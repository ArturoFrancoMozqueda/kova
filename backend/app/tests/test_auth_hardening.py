"""Auth hardening tests (security review, 2026-06).

Covers the findings remediated in the auth/session security review:
  F1 — login timing equalization (no user-enumeration via bcrypt timing)
  F3 — email normalization (case-insensitive identity)
  F4 — reset-token invalidation on re-request and on confirm
  F6 — absolute session lifetime cap on refresh
"""
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.auth import repository as repo
from app.auth import service
from app.auth.models import UserSession
from app.config import settings
from app.tests.test_auth import _signup, _verify, signup_and_login


def _session_for(db, email: str) -> UserSession:
    """Return the session belonging to a freshly-created test user.

    The dev database is shared with the running app, so a bare
    ``query(UserSession).first()`` can return an unrelated session committed by
    manual usage. Scope to the test user (which is unique per run) instead.
    """
    user = repo.get_user_by_email(db, email)
    assert user is not None
    return (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.desc())
        .first()
    )


# ── F1: login timing equalization ───────────────────────────────────────────

def test_login_unknown_email_still_runs_bcrypt(client: TestClient, monkeypatch) -> None:
    """An unknown email must still pay the bcrypt cost so response timing can't be
    used to tell whether an account exists."""
    calls: list[str] = []
    real = service.verify_password

    def spy(plain: str, hashed: str) -> bool:
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(service, "verify_password", spy)

    r = client.post(
        "/api/v1/auth/login",
        json={"email": "ghost@example.com", "password": "whatever1"},
    )
    assert r.status_code == 401
    assert calls, "verify_password must run even for an unknown email"
    assert calls[0] == service._DUMMY_PASSWORD_HASH


def test_login_unknown_vs_wrong_password_identical_response(client: TestClient) -> None:
    data = _signup(client)
    _verify(client, data["dev_verification_token"])

    unknown = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever1"},
    )
    wrong = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrongpass1"},
    )
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


# ── F3: email normalization ──────────────────────────────────────────────────

def test_login_is_case_insensitive(client: TestClient) -> None:
    data = _signup(client, email="Owner@Example.COM")
    _verify(client, data["dev_verification_token"])
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "S3cur3pass!"},
    )
    assert r.status_code == 200


def test_signup_case_variant_is_detected_as_existing(client: TestClient) -> None:
    data = _signup(client, email="dup@example.com")
    _verify(client, data["dev_verification_token"])

    r = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "DUP@Example.com",
            "password": "S3cur3pass!",
            "tenant_name": "X",
            "accepted_terms": True,
        },
    )
    assert r.status_code == 200
    assert r.json()["reason"] == "email_in_use"


def test_email_whitespace_is_trimmed(client: TestClient) -> None:
    data = _signup(client, email="  spaced@example.com  ")
    _verify(client, data["dev_verification_token"])
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "spaced@example.com", "password": "S3cur3pass!"},
    )
    assert r.status_code == 200


# ── F3 (DB layer): case-insensitive uniqueness enforced by the database ──────

def test_db_rejects_case_variant_duplicate_email(db) -> None:
    """The functional unique index on lower(email) must block a case-variant
    duplicate even if a write path skips the schema-level normalization."""
    repo.create_user(db, email="dbcase@example.com", hashed_password="x")
    db.flush()

    sp = db.begin_nested()
    with pytest.raises(IntegrityError):
        repo.create_user(db, email="DBCase@Example.com", hashed_password="x")
        db.flush()
    sp.rollback()


# ── F4: reset-token invalidation ─────────────────────────────────────────────

def test_password_reset_request_invalidates_prior_token(client: TestClient) -> None:
    data = _signup(client)
    _verify(client, data["dev_verification_token"])

    t1 = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "owner@example.com"}
    ).json()["dev_reset_token"]
    t2 = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "owner@example.com"}
    ).json()["dev_reset_token"]
    assert t1 and t2 and t1 != t2

    # The older link no longer works once a newer one is issued.
    stale = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": t1, "new_password": "N3wpass!"},
    )
    assert stale.status_code == 400

    # The newest link works.
    fresh = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": t2, "new_password": "N3wpass!"},
    )
    assert fresh.status_code == 200


# ── F6: absolute session lifetime ────────────────────────────────────────────

def test_refresh_rejected_past_absolute_lifetime(client: TestClient, db) -> None:
    signup_and_login(client)
    session = _session_for(db, "owner@example.com")
    session.created_at = datetime.now(UTC) - timedelta(
        seconds=settings.refresh_token_absolute_ttl_seconds + 10
    )
    db.flush()

    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 401

    db.refresh(session)
    assert session.revoked_at is not None  # session is killed, not just refused


def test_refresh_caps_expiry_at_absolute_deadline(client: TestClient, db) -> None:
    signup_and_login(client)
    session = _session_for(db, "owner@example.com")
    created = datetime.now(UTC) - timedelta(days=89)
    session.created_at = created
    db.flush()

    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200

    db.refresh(session)
    deadline = created + timedelta(seconds=settings.refresh_token_absolute_ttl_seconds)
    # New expiry is clamped to the absolute deadline (~1 day out), not now + 30d.
    assert session.expires_at.replace(tzinfo=UTC) <= deadline + timedelta(seconds=2)

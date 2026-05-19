"""Auth flow integration tests (Sprint 0B)."""
from fastapi.testclient import TestClient

from app.catalog.models import Product

# ── Helpers ───────────────────────────────────────────────────────────────────

def _signup(client: TestClient, email="owner@example.com", tenant="Acme Bakery") -> dict:
    r = client.post("/api/v1/auth/signup", json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant})
    assert r.status_code == 201, r.text
    return r.json()


def _verify(client: TestClient, token: str) -> None:
    r = client.post("/api/v1/auth/verify", json={"token": token})
    assert r.status_code == 200, r.text


def _login(client: TestClient, email="owner@example.com", password="S3cur3pass!") -> TestClient:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r


def signup_and_login(client: TestClient, email="owner@example.com", tenant="Acme Bakery") -> None:
    data = _signup(client, email=email, tenant=tenant)
    _verify(client, data["dev_verification_token"])
    _login(client, email=email)


# ── Signup ────────────────────────────────────────────────────────────────────

def test_signup_creates_user_and_tenant(client):
    data = _signup(client)
    assert data["user_id"]
    assert data["tenant_id"]
    assert "dev_verification_token" in data


def test_signup_starts_with_empty_catalog(client, db):
    data = _signup(client, email="empty-catalog@example.com", tenant="Empty Catalog Bakery")

    product_count = db.query(Product).filter(Product.tenant_id == data["tenant_id"]).count()

    assert product_count == 0


def test_signup_duplicate_email_returns_400(client):
    _signup(client)
    r = client.post("/api/v1/auth/signup", json={"email": "owner@example.com", "password": "x", "tenant_name": "X"})
    assert r.status_code == 400


def test_signup_returns_dev_token_in_local_env(client):
    data = _signup(client)
    assert data["dev_verification_token"] is not None


# ── Verify ────────────────────────────────────────────────────────────────────

def test_verify_email(client):
    data = _signup(client)
    r = client.post("/api/v1/auth/verify", json={"token": data["dev_verification_token"]})
    assert r.status_code == 200


def test_verify_invalid_token_returns_400(client):
    r = client.post("/api/v1/auth/verify", json={"token": "notavalidtoken"})
    assert r.status_code == 400


# ── Login ─────────────────────────────────────────────────────────────────────

def test_login_sets_cookies(client):
    data = _signup(client)
    _verify(client, data["dev_verification_token"])
    r = _login(client)
    assert "access_token" in r.cookies
    assert "refresh_token" in r.cookies


def test_login_wrong_password_returns_401(client):
    data = _signup(client)
    _verify(client, data["dev_verification_token"])
    r = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": "wrong"})
    assert r.status_code == 401


def test_login_unverified_email_returns_403(client):
    _signup(client)
    r = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": "S3cur3pass!"})
    assert r.status_code == 403


# ── Me ────────────────────────────────────────────────────────────────────────

def test_me_returns_user_and_tenant(client):
    signup_and_login(client)
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "owner@example.com"
    assert body["user"]["role"] == "owner"
    assert body["tenant_id"]


def test_me_unauthenticated_returns_401(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_session_probe_returns_false_without_cookie(client):
    r = client.get("/api/v1/auth/session")
    assert r.status_code == 200
    assert r.json() == {
        "authenticated": False,
        "user": None,
        "tenant_id": None,
        "tenant_name": None,
    }


def test_session_probe_returns_user_and_tenant_when_authenticated(client):
    signup_and_login(client)
    r = client.get("/api/v1/auth/session")
    assert r.status_code == 200
    body = r.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == "owner@example.com"
    assert body["tenant_name"] == "Acme Bakery"


# ── Refresh ───────────────────────────────────────────────────────────────────

def test_refresh_issues_new_access_token(client):
    signup_and_login(client)
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    # Session is still valid after refresh
    r2 = client.get("/api/v1/auth/me")
    assert r2.status_code == 200


def test_refresh_without_cookie_returns_401(client):
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

def test_logout_revokes_session(client):
    signup_and_login(client)
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204
    # Subsequent authenticated request fails
    r2 = client.get("/api/v1/auth/me")
    assert r2.status_code == 401


def test_logout_all_revokes_all_sessions(client):
    signup_and_login(client)
    r = client.post("/api/v1/auth/logout-all")
    assert r.status_code == 204
    r2 = client.get("/api/v1/auth/me")
    assert r2.status_code == 401


# ── Password reset ────────────────────────────────────────────────────────────

def test_password_reset_flow(client):
    data = _signup(client)
    _verify(client, data["dev_verification_token"])

    # Request reset
    r = client.post("/api/v1/auth/password-reset/request", json={"email": "owner@example.com"})
    assert r.status_code == 200
    reset_token = r.json()["dev_reset_token"]
    assert reset_token

    # Confirm reset
    r2 = client.post("/api/v1/auth/password-reset/confirm", json={"token": reset_token, "new_password": "N3wpass!"})
    assert r2.status_code == 200

    # Old password rejected
    r3 = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": "S3cur3pass!"})
    assert r3.status_code == 401

    # New password accepted
    r4 = client.post("/api/v1/auth/login", json={"email": "owner@example.com", "password": "N3wpass!"})
    assert r4.status_code == 200


def test_password_reset_unknown_email_still_200(client):
    r = client.post("/api/v1/auth/password-reset/request", json={"email": "ghost@example.com"})
    assert r.status_code == 200


def test_password_reset_token_single_use(client):
    data = _signup(client)
    _verify(client, data["dev_verification_token"])
    r = client.post("/api/v1/auth/password-reset/request", json={"email": "owner@example.com"})
    token = r.json()["dev_reset_token"]

    client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "N3wpass!"})
    r2 = client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "Another1!"})
    assert r2.status_code == 400

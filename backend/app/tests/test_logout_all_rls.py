"""Account-wide logout must revoke own sessions across tenants with runtime RLS."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.service import _hash_token, create_access_token
from app.db import get_db, get_privileged_db
from app.main import app


def test_logout_all_revokes_only_current_users_sessions_across_tenants(
    owner_engine, kova_app_engine
):
    tenant_a, tenant_b, user, other_user = (uuid4() for _ in range(4))
    own_session_a, own_session_b, other_session = (uuid4() for _ in range(3))
    with owner_engine.begin() as conn:
        for tenant in (tenant_a, tenant_b):
            conn.execute(
                text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Logout RLS', :slug)"),
                {"id": tenant, "slug": f"logout-{tenant}"},
            )
        for identity in (user, other_user):
            conn.execute(
                text("INSERT INTO users (id, email, hashed_password, is_email_verified) VALUES (:id, :email, 'synthetic-unused-hash', true)"),
                {"id": identity, "email": f"logout-{identity}@example.com"},
            )
        for tenant, identity in ((tenant_a, user), (tenant_b, user), (tenant_a, other_user)):
            conn.execute(
                text("INSERT INTO memberships (tenant_id, user_id, role) VALUES (:tenant, :user, 'owner')"),
                {"tenant": tenant, "user": identity},
            )
        for session, tenant, identity in (
            (own_session_a, tenant_a, user),
            (own_session_b, tenant_b, user),
            (other_session, tenant_a, other_user),
        ):
            conn.execute(
                text("INSERT INTO sessions (id, tenant_id, user_id, refresh_token_hash, expires_at) VALUES (:session, :tenant, :user, :hash, now() + interval '1 day')"),
                {"session": session, "tenant": tenant, "user": identity, "hash": _hash_token(str(session))},
            )

    def runtime_db():
        with Session(kova_app_engine) as db:
            yield db

    def privileged_db():
        with Session(owner_engine) as db:
            yield db

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = runtime_db
    app.dependency_overrides[get_privileged_db] = privileged_db
    try:
        with TestClient(app) as client:
            client.cookies.set("access_token", create_access_token(user, tenant_a, own_session_a), domain="testserver.local")
            client.cookies.set("csrf_token", "synthetic-csrf", domain="testserver.local")
            assert client.get("/api/v1/auth/me").status_code == 200
            response = client.post("/api/v1/auth/logout-all")
            assert response.status_code == 204
            assert "access_token" not in client.cookies
            with owner_engine.connect() as conn:
                states = dict(conn.execute(
                    text("SELECT id, revoked_at IS NOT NULL FROM sessions WHERE id IN (:a, :b, :other)"),
                    {"a": own_session_a, "b": own_session_b, "other": other_session},
                ).all())
            assert states == {own_session_a: True, own_session_b: True, other_session: False}
            # The other-tenant cookie is still correctly signed, but its
            # persisted session must now reject both access and refresh.
            client.cookies.set("access_token", create_access_token(user, tenant_b, own_session_b), domain="testserver.local")
            client.cookies.set("refresh_token", str(own_session_b), path="/api/v1/auth", domain="testserver.local")
            client.cookies.set("csrf_token", "synthetic-csrf", domain="testserver.local")
            assert client.get("/api/v1/auth/me").status_code == 401
            assert client.post("/api/v1/auth/refresh").status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        with owner_engine.begin() as conn:
            conn.execute(text("DELETE FROM audit_logs WHERE tenant_id IN (:a, :b)"), {"a": tenant_a, "b": tenant_b})
            conn.execute(text("DELETE FROM users WHERE id IN (:user, :other)"), {"user": user, "other": other_user})
            conn.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": tenant_a, "b": tenant_b})

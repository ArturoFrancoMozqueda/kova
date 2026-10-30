"""Executed on stdin only in the disposable restore API image, never production.

The caller verifies container isolation before starting this code. Restored users,
passwords, sessions and subscription state are not changed. A synthetic owner is
created only in the offline clone to read an existing tenant's portability export.
No customer rows, credentials, cookies or archive bytes may reach stdout.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import re
import secrets
import zipfile
from uuid import uuid4
from urllib.parse import parse_qsl, urlsplit


def require(condition):
    if not condition:
        raise RuntimeError("Isolated restore application check failed")


def validate_environment(environ, interfaces):
    require(re.fullmatch(r"[1-9][0-9]*-[1-9][0-9]*", environ.get("RESTORE_DRILL_ID", "")))
    require(environ.get("APP_ENV") == "ci")
    require(environ.get("CLOUDFLARE_CONTAINER_MODE") == "false")
    require(set(interfaces) == {"lo"})
    for key, user in (("DATABASE_URL", "restore_owner"), ("APP_DATABASE_URL", "kova_app")):
        url = urlsplit(environ[key])
        require(url.scheme == "postgresql+psycopg" and url.hostname == "127.0.0.1")
        require(url.port == 5432 and url.path == "/kova_restore" and url.username == user)
        require(url.password and parse_qsl(url.query) == [("sslmode", "disable")] and not url.fragment)
    require(not any(environ.get(key) for key in (
        "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "SENTRY_DSN",
        "UPSTASH_REDIS_REST_URL", "MIGRATION_DATABASE_URL",
    )))


async def check_api(app, email, password, tenant_id, expected):
    import httpx

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://restore.invalid",
        headers={"Origin": "https://restore.invalid"}, follow_redirects=False,
    ) as client:
        require((await client.get("/health")).status_code == 200)
        require((await client.get("/health/db")).json() == {"status": "ok", "db": "reachable"})
        require((await client.get("/api/v1/auth/me")).status_code == 401)
        login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        require(login.status_code == 200)
        for name in ("access_token", "refresh_token"):
            cookie = next(c for c in client.cookies.jar if c.name == name)
            require(cookie.secure and cookie.has_nonstandard_attr("HttpOnly"))
        me = await client.get("/api/v1/auth/me")
        require(me.status_code == 200 and me.json()["tenant_id"] == str(tenant_id))
        mismatch = await client.get("/api/v1/export/account", headers={"X-Kova-Expected-Tenant": str(uuid4())})
        require(mismatch.status_code == 409)
        response = await client.get("/api/v1/export/account")
        require(response.status_code == 200 and "no-store" in response.headers["cache-control"])
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            require(manifest["tenant_id"] == str(tenant_id))
            for table, count in expected.items():
                require(manifest["tables"][table] == count)
                with archive.open(f"datos/{table}.csv") as entry:
                    rows = list(csv.DictReader(io.TextIOWrapper(entry, encoding="utf-8-sig")))
                require(len(rows) == count)
                require(all(row["tenant_id"] == str(tenant_id) for row in rows))
        # Prove the session is revocable with the unchanged CSRF mechanism.
        require((await client.post("/api/v1/auth/logout")).status_code == 403)
        logout = await client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": client.cookies["csrf_token"]})
        require(logout.status_code == 204)
        require((await client.get("/api/v1/auth/me")).status_code == 401)


def main():
    validate_environment(os.environ, os.listdir("/sys/class/net"))
    # The authentication signing root and QA password exist in this process only.
    os.environ["SECRET_KEY"] = secrets.token_urlsafe(48)
    from sqlalchemy import create_engine, text

    owner = create_engine(os.environ["DATABASE_URL"], hide_parameters=True)
    runtime = create_engine(os.environ["APP_DATABASE_URL"], hide_parameters=True)
    with owner.connect() as conn:
        require(tuple(conn.execute(text("SELECT current_database(), current_user")).one()) == ("kova_restore", "restore_owner"))
        require(conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == os.environ["RESTORE_EXPECTED_REVISION"])
        tenant_id = conn.execute(text("SELECT tenant_id FROM orders GROUP BY tenant_id ORDER BY count(*) DESC, tenant_id LIMIT 1")).scalar_one()
        expected = {
            table: conn.execute(text(f"SELECT count(*) FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant_id}).scalar_one()
            for table in ("orders", "payments", "products")
        }
        require(expected["orders"] > 0)
    with runtime.begin() as conn:
        role = conn.execute(text("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")).one()
        require(tuple(role) == ("kova_app", False, False))
        require(conn.execute(text("SELECT count(*) FROM orders")).scalar_one() == 0)
        conn.execute(text("SELECT set_config('app.tenant_id', :tenant, true)"), {"tenant": str(tenant_id)})
        require(conn.execute(text("SELECT count(*) FROM orders")).scalar_one() == expected["orders"])
    from app.main import app
    from app.auth.service import hash_password
    from app.db import assert_rls_active

    # CI normally warns about posture drift. Explicitly require a complete
    # policy snapshot here as well as the independent SQL drill checks.
    require(assert_rls_active() is not None)
    email, password, user_id = f"restore-{uuid4().hex}@example.com", secrets.token_urlsafe(32), uuid4()
    with owner.begin() as conn:
        conn.execute(text(
            "INSERT INTO users (id,email,hashed_password,is_email_verified,is_active,created_at,updated_at) "
            "VALUES (:id,:email,:password,true,true,now(),now())"
        ), {"id": user_id, "email": email, "password": hash_password(password)})
        conn.execute(text(
            "INSERT INTO memberships (id,tenant_id,user_id,role,is_active,created_at) "
            "VALUES (:id,:tenant,:user,'owner',true,now())"
        ), {"id": uuid4(), "tenant": tenant_id, "user": user_id})
    asyncio.run(check_api(app, email, password, tenant_id, expected))
    owner.dispose()
    runtime.dispose()
    print(json.dumps({"health": True, "database": True, "cookie_login": True,
                      "restored_export": True, "logout": True, "runtime_rls": True,
                      "restored_orders": expected["orders"]}))


if __name__ == "__main__":
    main()

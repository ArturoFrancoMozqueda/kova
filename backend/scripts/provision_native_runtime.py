"""First-time native runtime credentials, executed explicitly in release CI only.

The existing Hyperdrive role/password is never changed. The new login inherits
the reviewed ``kova_app`` grant matrix and remains subject to the same RLS.
Credentials stay in process memory and Cloudflare's sealed secret store; this
command never emits URLs, passwords, API error bodies, or exception messages.

This is intentionally not a rotation command. An existing role or either
target secret aborts before changes. A failed secret upload rolls back the
uncommitted role and removes only the initially absent target secrets.
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import sys
from collections.abc import Mapping

import httpx
import psycopg
from psycopg import sql
from sqlalchemy.engine import URL, make_url

ROLE = "kova_native_app"
WORKER = "kova-backend"
SECRET_NAMES = ("APP_DATABASE_URL", "MIGRATION_DATABASE_URL")


class ProvisionError(RuntimeError):
    """A safe, fixed diagnostic that does not contain credential material."""


def database_urls(owner: str, password: str) -> tuple[URL, URL]:
    """Preserve the endpoint and Supavisor project suffix for the new login."""
    try:
        privileged = make_url(owner)
    except Exception:
        raise ProvisionError("Invalid owner connection configuration") from None
    if (
        privileged.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}
        or not privileged.host
        or not privileged.username
        or not privileged.password
        or not privileged.database
        or any(
            key.lower() in {
                "options", "user", "password", "dbname", "host", "hostaddr", "port",
                "service", "servicefile", "passfile",
            }
            for key in privileged.query
        )
    ):
        raise ProvisionError("Invalid owner connection configuration")
    # Require encrypted connections. Do not inherit a weaker operator setting.
    if privileged.query.get("sslmode", "require") not in {"require", "verify-full"}:
        raise ProvisionError("Native database connections must require TLS")
    privileged = privileged.set(drivername="postgresql+psycopg").update_query_dict(
        {"sslmode": privileged.query.get("sslmode", "require")}
    )
    username = ROLE
    if privileged.host.endswith(".pooler.supabase.com"):
        _, separator, project = privileged.username.rpartition(".")
        if not separator or not re.fullmatch(r"[a-z0-9]{20}", project):
            raise ProvisionError("Invalid Supabase pooler identity")
        username = f"{ROLE}.{project}"
    return privileged.set(username=username, password=password), privileged


class WorkerSecrets:
    """A write-only client. Secret values are never fetched from Cloudflare."""

    def __init__(self, account: str, token: str, client: httpx.Client):
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token:
            raise ProvisionError("Cloudflare CI configuration is missing")
        self._url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account}"
            f"/workers/scripts/{WORKER}/secrets"
        )
        self._headers = {"Authorization": f"Bearer {token}"}
        self._client = client

    def _request(self, method: str, suffix: str = "", *, missing_ok=False, **kwargs):
        try:
            response = self._client.request(
                method, self._url + suffix, headers=self._headers, **kwargs
            )
            if missing_ok and response.status_code == 404:
                return None
            result = response.json()
            if not response.is_success or result.get("success") is not True:
                raise ProvisionError("Cloudflare secret operation failed")
            return result.get("result")
        except ProvisionError:
            raise
        except Exception:
            raise ProvisionError("Cloudflare secret operation failed") from None

    def names(self) -> set[str]:
        result = self._request("GET")
        if not isinstance(result, list) or any(
            not isinstance(item, dict) or not isinstance(item.get("name"), str)
            for item in result
        ):
            raise ProvisionError("Invalid Cloudflare secret inventory")
        return {item["name"] for item in result}

    def put(self, name: str, value: str) -> None:
        if name not in SECRET_NAMES:
            raise ProvisionError("Unsupported target secret")
        self._request("PUT", json={"name": name, "text": value, "type": "secret_text"})

    def delete(self, name: str) -> None:
        if name not in SECRET_NAMES:
            raise ProvisionError("Unsupported target secret")
        self._request("DELETE", f"/{name}", missing_ok=True)


def provision(owner: str, store: WorkerSecrets, *, connect=psycopg.connect) -> None:
    """Create and seal once; the current production role is never rotated."""
    password = secrets.token_urlsafe(48)
    runtime, privileged = database_urls(owner, password)
    dsn = privileged.set(drivername="postgresql").render_as_string(hide_password=False)
    # A transaction spans creation and both sealed writes. No process can use
    # the new role until it commits. The advisory lock serializes this command.
    wrote_secrets = False
    try:
        with connect(dsn, connect_timeout=15) as conn:
            conn.execute("SELECT pg_advisory_xact_lock(hashtext('kova_native_runtime_v1'))")
            if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ROLE,)).fetchone():
                raise ProvisionError("Native runtime role already exists; rotation refused")
            source = conn.execute(
                "SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication "
                "FROM pg_roles WHERE rolname = 'kova_app'"
            ).fetchone()
            if source != (False, False, False, False, False):
                raise ProvisionError("Source runtime role has unsafe or missing attributes")
            if conn.execute(
                "SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member "
                "WHERE r.rolname = 'kova_app' LIMIT 1"
            ).fetchone():
                raise ProvisionError("Source runtime role has unexpected memberships")
            if conn.execute(
                "SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner "
                "WHERE r.rolname = 'kova_app' LIMIT 1"
            ).fetchone():
                raise ProvisionError("Source runtime role unexpectedly owns database objects")
            if store.names().intersection(SECRET_NAMES):
                raise ProvisionError("Native runtime secrets already exist; overwrite refused")
            # Send a SCRAM verifier rather than the password in the DDL statement.
            verifier = conn.pgconn.encrypt_password(
                password.encode(), ROLE.encode(), b"scram-sha-256"
            ).decode()
            conn.execute(
                sql.SQL(
                    "CREATE ROLE {} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS "
                    "NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD {}"
                ).format(sql.Identifier(ROLE), sql.Literal(verifier))
            )
            conn.execute(sql.SQL("GRANT kova_app TO {}").format(sql.Identifier(ROLE)))
            # Mark before PUT: a timed-out request might have reached the server.
            wrote_secrets = True
            store.put("APP_DATABASE_URL", runtime.render_as_string(hide_password=False))
            store.put("MIGRATION_DATABASE_URL", privileged.render_as_string(hide_password=False))
    except Exception:
        if wrote_secrets:
            cleanup_failed = False
            # Both names were absent before this transaction. Do not touch any
            # existing secret or another application's credentials.
            for name in SECRET_NAMES:
                try:
                    store.delete(name)
                except Exception:
                    cleanup_failed = True
            if cleanup_failed:
                raise ProvisionError(
                    "Provisioning failed; verify removal of the two native database secrets"
                ) from None
        raise ProvisionError(
            "Native runtime provisioning aborted without changing Hyperdrive"
        ) from None


def main(argv: list[str] | None = None, *, environ: Mapping[str, str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provision-once", action="store_true", required=True)
    parser.parse_args(argv)
    env = os.environ if environ is None else environ
    if env.get("CI") != "true" or env.get("GITHUB_ACTIONS") != "true":
        print("Native runtime provisioning is restricted to explicit release CI", file=sys.stderr)
        return 2
    try:
        owner = env.get("SUPABASE_DB_URL", "")
        # Disable ambient proxies; token/URLs remain in
        # memory and are never passed through a shell argument or a temp file.
        with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
            store = WorkerSecrets(
                env.get("CLOUDFLARE_ACCOUNT_ID", ""), env.get("CLOUDFLARE_API_TOKEN", ""), client
            )
            provision(owner, store)
    except ProvisionError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print(
            "Native runtime provisioning failed; production Hyperdrive is unchanged",
            file=sys.stderr,
        )
        return 1
    print("Native runtime role and sealed database secrets provisioned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

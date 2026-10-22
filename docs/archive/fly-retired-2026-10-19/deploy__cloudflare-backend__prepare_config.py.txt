"""Transfer deployment bindings without printing or inspecting credential values.

Run with an authenticated Fly CLI. Output files are outside the checkout, mode
0600 in a mode-0700 directory. Feed them directly to cf --secrets-file/--body;
never upload them as build artifacts or include them in diagnostics.
"""

import argparse
import ast
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit


def write_private(path, value):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output)


def database_origin(connection):
    url = urlsplit(connection)
    if not url.hostname or not url.username or not url.password or not url.path:
        raise ValueError("Invalid database configuration")
    host, port, user = url.hostname, url.port or 5432, unquote(url.username)
    if host.endswith(".pooler.supabase.com"):
        # Hyperdrive performs pooling; chaining Supavisor's session pool causes
        # avoidable connection waits. Keep the same database role/password.
        role, separator, project = user.rpartition(".")
        if not separator or not role or not re.fullmatch(r"[a-z0-9]{20}", project):
            raise ValueError("Invalid Supabase connection metadata")
        host, port, user = f"db.{project}.supabase.co", 5432, role
    return {
        "scheme": "postgresql",
        "host": host,
        "port": port,
        "user": user,
        "password": unquote(url.password),
        "database": unquote(url.path.lstrip("/")),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fly", default="flyctl")
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.sha):
        raise SystemExit("An immutable source commit is required")
    root = Path(__file__).resolve().parents[2]
    tree = ast.parse((root / "backend/app/config.py").read_text())
    fields = next(
        item
        for item in tree.body
        if isinstance(item, ast.ClassDef) and item.name == "Settings"
    )
    names = {
        item.target.id.upper()
        for item in fields.body
        if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name)
    }
    names.update(
        item.value
        for item in ast.walk(fields)
        if isinstance(item, ast.Constant)
        and isinstance(item.value, str)
        and re.fullmatch(r"[A-Z][A-Z0-9_]+", item.value)
    )
    remote = (
        "import json,os; allowed="
        + repr(sorted(names))
        + ";print(json.dumps({k:v for k,v in os.environ.items() if k in allowed}))"
    )
    result = subprocess.run(
        [
            args.fly,
            "ssh",
            "console",
            "--app",
            "pos-project-backend",
            "--process-group",
            "app",
            "--quiet",
            "--command",
            "/app/.venv/bin/python -c " + shlex.quote(remote),
        ],
        capture_output=True,
        timeout=90,
    )
    if result.returncode:
        raise SystemExit(
            "Secure Fly configuration transfer failed; no values were displayed"
        )
    try:
        # Fly can prepend a connection banner to stdout even with --quiet.
        candidates = [
            line for line in result.stdout.splitlines() if line.startswith(b"{")
        ]
        if len(candidates) != 1:
            raise ValueError
        values = json.loads(candidates[0])
        if not isinstance(values, dict) or not all(
            isinstance(v, str) for v in values.values()
        ):
            raise ValueError
        missing = [
            name
            for name in (
                "APP_DATABASE_URL",
                "SECRET_KEY",
                "RESEND_API_KEY",
                "EMAIL_FROM",
            )
            if not values.get(name)
        ]
        if missing:
            raise SystemExit("Missing deployment bindings: " + ", ".join(missing))
    except (ValueError, TypeError):
        raise SystemExit(
            "Deployment configuration was incomplete; no values were displayed"
        ) from None
    owner = values.get("MIGRATION_DATABASE_URL") or values.get("DATABASE_URL")
    if not owner or owner == values["APP_DATABASE_URL"]:
        raise SystemExit("Separate runtime and privileged connections are required")
    destination = Path(tempfile.mkdtemp(prefix="kova-cf-deployment-"))
    os.chmod(destination, 0o700)
    for label, connection in (
        ("app", values["APP_DATABASE_URL"]),
        ("privileged", owner),
    ):
        try:
            origin = database_origin(connection)
        except ValueError:
            raise SystemExit("Invalid database configuration; no values were displayed")
        write_private(
            destination / f"hyperdrive-{label}.json",
            {
                "name": f"kova-{label}",
                "origin": origin,
                "caching": {"disabled": True},
                "origin_connection_limit": 5,
            },
        )
    excluded = {
        "DATABASE_URL",
        "APP_DATABASE_URL",
        "MIGRATION_DATABASE_URL",
        "ASSISTANT_INGEST_FLY_TOKEN",
        "ASSISTANT_INGEST_MACHINE_ID",
    }
    api = {k: v for k, v in values.items() if k not in excluded}
    api.update(
        {
            "APP_ENV": "production",
            "ASSISTANT_DOCUMENTS_ENABLED": "false",
            "ASSISTANT_INGEST_ON_DEMAND": "false",
            "TRUSTED_CLIENT_IP_HEADER": "x-kova-client-ip",
            "KOVA_RELEASE_SHA": args.sha,
            "GIT_SHA": args.sha,
        }
    )
    jobs = {
        k: v
        for k, v in api.items()
        if k.startswith("ASSISTANT_")
        or k
        in {
            "APP_ENV",
            "AUTOMATION_TENANT_IDS",
            "SECRET_KEY",
            "RESEND_API_KEY",
            "EMAIL_FROM",
            "FRONTEND_URL",
            "SENTRY_DSN",
            "SENTRY_TRACES_SAMPLE_RATE",
            "GIT_SHA",
            "KOVA_RELEASE_SHA",
        }
    }
    if len(api) + 5 > 64 or len(jobs) + 2 > 64:
        raise SystemExit("Deployment exceeds Free binding count")
    write_private(destination / "api-secrets.json", api)
    write_private(destination / "jobs-secrets.json", jobs)
    print(
        f"Prepared private deployment inputs in {destination}; values were not displayed."
    )


if __name__ == "__main__":
    main()

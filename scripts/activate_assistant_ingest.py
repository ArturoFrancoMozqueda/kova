"""Manual, serialized activation using the existing protected deployment identity."""

import argparse
import json
import os
import re
import shlex
import subprocess
import time
import urllib.request

from assistant_host_release import command, hosts, image_identity, remote, serving_image

TOKEN_NAME = "ASSISTANT_INGEST_FLY_TOKEN"


def ensure_token(target, run=subprocess.run):
    names = json.loads(command(["secrets", "list", "--json"], run=run))
    if not isinstance(names, list):
        raise RuntimeError("Invalid secret name metadata")
    if any(item.get("name", item.get("Name")) == TOKEN_NAME for item in names):
        return
    # A newly minted app-scoped credential travels only through captured memory
    # and stdin to Fly's encrypted vault, never argv, files, outputs or logs.
    token = command(["tokens", "create", "deploy", "--name", "kova-ingest-wake",
                     "--expiry", "8760h"], run=run).strip()
    if not re.fullmatch(r"(?:FlyV1 )?fm2_[A-Za-z0-9_./+=:,-]+", token):
        raise RuntimeError("Unexpected app token format; activation stopped")
    # Attenuate the newly minted app token to read/control one existing Machine.
    # Runtime code cannot create, resize, deploy or operate on POS/chat hosts.
    narrowed = run(["flyctl", "tokens", "attenuate"],
                   input=json.dumps([{"type": "Machines", "body": {
                       "machines": {target: "rC"}}}]),
                   env={**os.environ, "FLY_API_TOKEN": token},
                   capture_output=True, text=True, timeout=60, check=False)
    if narrowed.returncode or not re.fullmatch(
        r"(?:FlyV1 )?fm2_[A-Za-z0-9_./+=:,-]+", narrowed.stdout.strip()
    ):
        raise RuntimeError("Could not restrict the document wake token")
    command(["secrets", "import", "--stage"], run=run,
            input=TOKEN_NAME + "=" + narrowed.stdout.strip() + "\n")


def public_health(sha):
    with urllib.request.urlopen("https://api.kovasuite.com/health", timeout=20) as response:
        body = json.load(response)
    if body.get("status") != "ok" or body.get("release_sha") != sha:
        raise RuntimeError("Production release no longer matches activation")
    with urllib.request.urlopen("https://api.kovasuite.com/health/db", timeout=20) as response:
        if json.load(response).get("db") != "reachable":
            raise RuntimeError("Production database is unavailable")


def idle(identifier, *, run):
    source = """from sqlalchemy import text
from app.db import SessionLocal
with SessionLocal() as db:
    count=db.execute(text("SELECT count(*) FROM assistant_control.slots "
        "WHERE workload='ingest' AND expires_at>now()")).scalar_one()
assert count == 0
print('IDLE')
"""
    if remote(identifier, "/app/.venv/bin/python -c " + shlex.quote(source),
              timeout=20, run=run, stage="document drain") != "IDLE\n":
        raise RuntimeError("Document work must finish before activation")


def dispatcher_probe(identifier, target, *, run):
    source = """import asyncio
import httpx
from app.config import settings
from app.assistant.ingest_demand import configured, wake
assert settings.assistant_ingest_on_demand and configured()
assert settings.assistant_documents_enabled
assert settings.assistant_ingest_machine_id == TARGET
async def check():
    async with httpx.AsyncClient(base_url='https://api.machines.dev',timeout=5,trust_env=False,
        headers={'Authorization':'Bearer '+
            settings.assistant_ingest_fly_token.get_secret_value()}) as client:
        await wake(client)
asyncio.run(check())
print('DISPATCHER_OK')
""".replace("TARGET", repr(target))
    if remote(identifier, "/app/.venv/bin/python -c " + shlex.quote(source),
              timeout=30, run=run, stage="wake permission") != "DISPATCHER_OK\n":
        raise RuntimeError("Document wake permission did not pass")


def activate(sha, *, run=subprocess.run, sleep=time.sleep, health=public_health):
    health(sha)
    machines, ingest = hosts(run)
    image = serving_image(machines, sha)
    if (len(ingest) != 1 or ingest[0]["config"].get("env", {}).get("GIT_SHA") != sha
            or image_identity(ingest[0]) != image):
        raise RuntimeError("Publish and verify the isolated host on the current release first")
    apps = [m for m in machines if m.get("state") == "started"
            and m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app"]
    if len(apps) < 2:
        raise RuntimeError("Two healthy API Machines are required for activation without downtime")
    target = ingest[0]["id"]
    # Check control metadata only; no tenant content or credential values are read.
    idle(apps[0]["id"], run=run)
    ensure_token(target, run)
    changed = []
    try:
        for app in apps:
            changed.append(app["id"])
            command(["machine", "update", app["id"], "--yes",
                     "--env", "ASSISTANT_INGEST_ON_DEMAND=true",
                     "--env", "ASSISTANT_DOCUMENTS_ENABLED=true",
                     "--env", "ASSISTANT_INGEST_MACHINE_ID=" + target], run=run)
            health(sha)
            dispatcher_probe(app["id"], target, run=run)
        idle(apps[0]["id"], run=run)
        command(["machine", "update", target, "--restart", "on-fail", "--yes",
                 "--env", "ASSISTANT_INGEST_ON_DEMAND=true",
                 "--env", "ASSISTANT_DOCUMENTS_ENABLED=true",
                 "--env", "ASSISTANT_INGEST_VERIFY_UNTIL=0",
                 "--env", "ASSISTANT_INGEST_MACHINE_ID=" + target], run=run)
        health(sha)
    except Exception:
        # API/chat service configuration, images and capacity stay intact.
        # Restore only the feature overrides actually changed by this operation.
        for identifier in changed:
            previous = next(m for m in apps if m["id"] == identifier)["config"].get("env", {})
            command(["machine", "update", identifier, "--yes", "--env",
                     "ASSISTANT_INGEST_ON_DEMAND=" + previous.get(
                         "ASSISTANT_INGEST_ON_DEMAND", "false"), "--env",
                     "ASSISTANT_DOCUMENTS_ENABLED=" + previous.get(
                         "ASSISTANT_DOCUMENTS_ENABLED", "false")], run=run)
        # Do not interrupt any document that may have started in the new mode.
        raise
    print("Document demand activation configured; no API/chat capacity changed", flush=True)
    # Empty-queue acceptance; the subsequent authenticated upload is a separate QA.
    for _ in range(24):
        sleep(5)
        _, current = hosts(run)
        if current[0].get("state") == "stopped":
            health(sha)
            print("Document host stopped after its idle grace", flush=True)
            return target
    raise RuntimeError("Host remains active; check for pending work before any manual stop")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        activate(args.sha)
    except Exception:
        raise SystemExit(
            "Document activation did not complete; inspect its stage and state"
        ) from None

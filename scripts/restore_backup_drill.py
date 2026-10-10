#!/usr/bin/env python3
"""Restore an R2 backup only inside an offline, disposable GitHub-hosted container.

No destination URL is accepted. Raw database data, provider output and dumps never
become logs or artifacts. Only read-only R2 commands and aggregate evidence leave
the private work directory. The clone has no network, host mounts or published ports.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ACKNOWLEDGEMENT = "KOVA-R2-RESTORE-RUNNER-ONLY"
IMAGE = "pgvector/pgvector:0.8.7-pg17-bookworm@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d"
LABEL = "org.kova.restore-drill"
KEY_PATTERN = re.compile(r"^supabase/postgres/kova-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ)\.dump$")


class DrillError(Exception):
    """Only developer-authored, non-sensitive diagnostics may reach logs."""


def run_command(args, *, input_data=None, timeout=120):
    try:
        result = subprocess.run(args, input=input_data, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DrillError("Restore operation unavailable or timed out; no raw output retained") from None
    if result.returncode:
        raise DrillError("Restore operation failed; raw output intentionally withheld")
    return result.stdout


def runner_identity(environ, *, cleanup=False):
    required = {
        "GITHUB_ACTIONS": "true", "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch", "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux",
    }
    if any(environ.get(key) != value for key, value in required.items()):
        raise DrillError("Restore requires a manual main run on a GitHub-hosted Linux runner")
    if not cleanup and environ.get("RESTORE_ACKNOWLEDGEMENT") != ACKNOWLEDGEMENT:
        raise DrillError("Restore acknowledgement does not match")
    run_id, attempt = environ.get("GITHUB_RUN_ID", ""), environ.get("GITHUB_RUN_ATTEMPT", "")
    if not re.fullmatch(r"[1-9][0-9]*", run_id) or not re.fullmatch(r"[1-9][0-9]*", attempt):
        raise DrillError("Invalid runner execution identity")
    if not re.fullmatch(r"[0-9a-f]{40}", environ.get("GITHUB_SHA", "")):
        raise DrillError("Invalid runner source revision")
    temp = Path(environ.get("RUNNER_TEMP", ""))
    if not temp.is_absolute() or not temp.is_dir() or temp.resolve() == Path("/"):
        raise DrillError("Private runner temp directory unavailable")
    identity = f"{run_id}-{attempt}"
    private = temp / f"kova-r2-restore-{identity}"
    if private.is_symlink() or private.resolve().parent != temp.resolve():
        raise DrillError("Unsafe private runner directory")
    return identity, f"kova-r2-restore-{identity}", private, temp / "kova-r2-restore-evidence.json"


def select_backup(objects, now):
    candidates = []
    for item in objects:
        match = KEY_PATTERN.fullmatch(item.get("Key", ""))
        if match:
            timestamp = datetime.strptime(match.group(1), "%Y-%m-%dT%H-%M-%SZ").replace(tzinfo=UTC)
            candidates.append((timestamp, item["Key"]))
    if not candidates:
        raise DrillError("No application custom backup found")
    timestamp, key = max(candidates)
    age = (now - timestamp).total_seconds()
    if age < -300 or age > 48 * 3600:
        raise DrillError("Latest backup timestamp is outside the 48-hour restore window")
    return key, timestamp


def validate_dump(path, metadata):
    expected = metadata.get("Metadata", {}).get("sha256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise DrillError("Backup is missing valid trusted SHA-256 metadata")
    size = path.stat().st_size
    if size < 5 or size > 512 * 1024 * 1024 or size != metadata.get("ContentLength"):
        raise DrillError("Backup size does not match R2 metadata")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        if stream.read(5) != b"PGDMP":
            raise DrillError("Backup is not a PostgreSQL custom archive")
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise DrillError("Backup checksum does not match trusted R2 metadata")
    return size, expected


def validate_container(details, identity, *, cleanup_only=False):
    if len(details) != 1:
        raise DrillError("Disposable container identity could not be verified")
    item = details[0]
    config, host = item.get("Config", {}), item.get("HostConfig", {})
    if config.get("Labels", {}).get(LABEL) != identity:
        raise DrillError("Disposable container identity mismatch")
    if cleanup_only:
        return
    if config.get("User") != "postgres":
        raise DrillError("Disposable container user mismatch")
    if (host.get("NetworkMode") != "none" or not host.get("ReadonlyRootfs")
            or host.get("PortBindings") or any(m.get("Type") != "tmpfs" for m in item.get("Mounts", []))):
        raise DrillError("Restore container must have no network, ports or persistent mounts")


def cleanup(identity, container, private, run=run_command):
    try:
        containers = run(["docker", "ps", "-aq", "--filter", f"name=^/{container}$"]).decode().strip()
        if containers:
            details = json.loads(run(["docker", "inspect", container]))
            # Remove our own failed container even when the isolation preflight
            # rejected it. Never remove an unrelated container with the same name.
            validate_container(details, identity, cleanup_only=True)
            run(["docker", "rm", "--volumes", "-f", container])
        if run(["docker", "ps", "-aq", "--filter", f"name=^/{container}$"]).strip():
            raise DrillError("Disposable container cleanup could not be verified")
    finally:
        if private.exists():
            shutil.rmtree(private)
    if private.exists():
        raise DrillError("Private backup file cleanup could not be verified")


def known_revisions():
    revisions = set()
    for path in (ROOT / "backend/alembic/versions").glob("*.py"):
        for node in ast.parse(path.read_text()).body:
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target if isinstance(node, ast.AnnAssign) else None
            if isinstance(target, ast.Name) and target.id == "revision":
                revisions.add(ast.literal_eval(node.value))
    return revisions


def restore(environ, run=run_command):
    identity, container, private, evidence = runner_identity(environ)
    if not all(environ.get(name) for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "R2_BUCKET")):
        raise DrillError("Required read access to R2 backup storage is unavailable")
    account = environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not re.fullmatch(r"[a-f0-9]{32}", account):
        raise DrillError("Invalid R2 account configuration")
    endpoint = f"https://{account}.r2.cloudflarestorage.com"
    bucket = environ["R2_BUCKET"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        raise DrillError("Invalid R2 bucket configuration")
    if private.exists():
        raise DrillError("Private work directory already exists; run cleanup before retrying")
    private.mkdir(mode=0o700)
    started = datetime.now(UTC)
    timer = time.monotonic()
    stage = "download"
    try:
        def aws(operation, *args):
            return run(["aws", "s3api", operation, "--bucket", bucket, "--endpoint-url", endpoint, *args])
        listing = json.loads(aws("list-objects-v2", "--prefix", "supabase/postgres/", "--output", "json"))
        key, backup_at = select_backup(listing.get("Contents", []), started)
        metadata = json.loads(aws("head-object", "--key", key, "--output", "json"))
        if not 5 <= metadata.get("ContentLength", 0) <= 512 * 1024 * 1024:
            raise DrillError("Backup size exceeds the disposable runner limit")
        dump = private / "backup.dump"
        aws("get-object", "--key", key, str(dump))
        dump.chmod(0o600)
        size, checksum = validate_dump(dump, metadata)
        stage = "container"
        run(["docker", "pull", IMAGE], timeout=180)
        run([
            "docker", "run", "-d", "--name", container, "--label", f"{LABEL}={identity}",
            "--network", "none", "--user", "postgres", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--memory", "3g", "--cpus", "2",
            "--tmpfs", "/tmp:rw,nosuid,size=2g", "--tmpfs", "/var/run/postgresql:rw,nosuid,mode=1777,size=16m",
            # Override the image's declared VOLUME as tmpfs too; changing PGDATA
            # alone would leave an anonymous persistent Docker volume behind.
            "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,mode=1777,size=16m",
            "-e", "PGDATA=/tmp/pgdata", "-e", "POSTGRES_USER=restore_owner", "-e", "POSTGRES_DB=kova_restore",
            "-e", f"POSTGRES_PASSWORD={uuid4().hex}", IMAGE,
            "postgres", "-c", "listen_addresses=", "-c", "unix_socket_directories=/tmp",
        ])
        validate_container(json.loads(run(["docker", "inspect", container])), identity)
        psql = ["docker", "exec", "-i", container, "psql", "-X", "-h", "/tmp", "-U", "restore_owner",
                "-d", "kova_restore", "-v", "ON_ERROR_STOP=1", "-qAt"]
        for attempt in range(30):
            try:
                run(psql, input_data=b"SELECT 1;", timeout=5)
                break
            except DrillError:
                if attempt == 29:
                    raise DrillError("Disposable database did not become ready") from None
                time.sleep(1)
        version = int(run(psql, input_data=b"SHOW server_version_num;").strip())
        if not 170000 <= version < 180000:
            raise DrillError("Restore requires PostgreSQL 17")
        run(psql, input_data=b"CREATE SCHEMA extensions; CREATE SCHEMA assistant_control; "
                                b"CREATE EXTENSION vector WITH SCHEMA extensions; "
                                b"CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;")
        # Never mount host files or pass source credentials to the restored database.
        with dump.open("rb") as stream:
            run(["docker", "exec", "-i", container, "sh", "-c", "cat > /tmp/backup.dump"], input_data=stream.read())
        stage = "restore"
        restore_timer = time.monotonic()
        run(["docker", "exec", container, "pg_restore", "-h", "/tmp", "-U", "restore_owner",
             "--dbname", "kova_restore", "--schema=public", "--schema=assistant_control", "--no-owner",
             "--no-acl", "--clean", "--if-exists", "--exit-on-error", "--single-transaction", "/tmp/backup.dump"], timeout=600)
        restore_seconds = round(time.monotonic() - restore_timer, 3)
        stage = "grants-and-checks"
        run(psql, input_data=(ROOT / "backend/scripts/provision_app_role.sql").read_bytes())
        checks = json.loads(run(psql, input_data=(ROOT / "scripts/restore_backup_checks.sql").read_bytes()))
        if checks.get("revision") not in known_revisions():
            raise DrillError("Restored migration revision is not recognized by this repository")
        report = {
            "scope": "Kova logical restore; public and assistant_control; disposable PostgreSQL 17 runner",
            "commit": environ["GITHUB_SHA"], "run_id": environ["GITHUB_RUN_ID"],
            "backup_key": key, "backup_sha256": checksum, "backup_bytes": size,
            "backup_at": backup_at.isoformat(), "started_at": started.isoformat(),
            "snapshot_age_seconds": round((started - backup_at).total_seconds(), 3),
            "restore_seconds": restore_seconds, "drill_seconds": round(time.monotonic() - timer, 3),
            "server_version_num": version, "checks": checks,
            "regional_supabase_recovery_tested": False,
        }
    except (ValueError, KeyError, TypeError):
        raise DrillError(f"Restore failed during {stage}; malformed metadata, no raw output retained") from None
    except DrillError:
        raise DrillError(f"Restore failed during {stage}; no raw output retained") from None
    finally:
        cleanup(identity, container, private, run)
    report["cleanup_verified"] = True
    report["drill_seconds"] = round(time.monotonic() - timer, 3)
    evidence.write_text(json.dumps(report, indent=2) + "\n")
    print("PASS: real R2 backup restored, aggregate checks approved and disposable data removed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    try:
        if args.cleanup:
            identity, container, private, _ = runner_identity(os.environ, cleanup=True)
            cleanup(identity, container, private)
            print("PASS: disposable restore resources are gone")
        else:
            restore(os.environ)
    except DrillError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

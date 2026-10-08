"""Maintain the isolated file host; provisioning is a separate, explicitly budgeted mode."""

import argparse
import json
import re
import shlex
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

APP = "pos-project-backend"
BACKEND = Path(__file__).resolve().parents[1] / "backend"
PARSER_COMMAND = "/app/.venv/bin/python /app/scripts/check_assistant_parser.py"
PARSER_CHECKS = {
    "UTF-8 business text", "DOCX text", "PDF text", "PDF Spanish OCR",
    "DOCX path traversal", "DOCX external relationship", "DOCX macro",
    "DOCX expanded part", "malformed PDF", "antivirus EICAR",
}


def command(args, *, run=subprocess.run, **kwargs):
    result = run(["flyctl", *args, "--app", APP], cwd=BACKEND,
                 capture_output=True, text=True, timeout=360, check=False, **kwargs)
    if result.returncode:
        # The subcommand is public and fixed; stdout/stderr can contain private
        # configuration and must never be copied into CI diagnostics.
        raise RuntimeError("Assistant host command failed: " + " ".join(args[:2]))
    return result.stdout


def remote(identifier, script, *, timeout, run, stage="remote probe"):
    # flyctl returns zero even when the remote process exits unsuccessfully.
    # Zero exit_code is omitted in Fly's JSON; require stdout as positive evidence.
    try:
        body = json.loads(command(["machine", "exec", identifier, script,
                                   "--timeout", str(timeout), "--json"], run=run))
    except (ValueError, TypeError):
        raise RuntimeError("Invalid isolated host execution result") from None
    if (not isinstance(body, dict) or type(body.get("exit_code", 0)) is not int
            or body.get("exit_code", 0) != 0 or not isinstance(body.get("stdout"), str)
            or not body["stdout"].strip()):
        # Only fixed exception types from a trusted probe may enter diagnostics;
        # provider output, private content and traceback messages stay suppressed.
        stderr = body.get("stderr", "") if isinstance(body, dict) else ""
        kinds = re.findall(r"(?m)^(AssertionError|SyntaxError|JSONDecodeError|"
                           r"FileNotFoundError|PermissionError|RuntimeError)\b", stderr) \
            if isinstance(stderr, str) else []
        suffix = ": " + kinds[-1] if kinds else ""
        raise RuntimeError("Isolated host " + stage + " failed" + suffix)
    return body["stdout"]


def worker_identity(identifier, run):
    # Read only command tokens and process identity, never /proc/*/environ.
    script = """import json
from pathlib import Path
workers = []
for path in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args = path.read_bytes().split(b'\\0')
        if (Path(args[0].decode()).name.startswith('python')
                and len(args) > 1 and args[1] in
                (b'scripts/run_assistant_ingest.py', b'/app/scripts/run_assistant_ingest.py')):
            workers.append([int(path.parent.name),
                            (path.parent / 'stat').read_text().rsplit(')', 1)[1].split()[19]])
    except (OSError, ValueError, IndexError):
        continue
assert len(workers) == 1
print(json.dumps(workers[0]))
"""
    try:
        value = json.loads(remote(identifier, "/app/.venv/bin/python -c " + shlex.quote(script),
                                  timeout=20, run=run, stage="worker identity probe"))
    except (ValueError, TypeError):
        raise RuntimeError("Invalid isolated worker identity") from None
    if (not isinstance(value, list) or len(value) != 2 or type(value[0]) is not int
            or value[0] <= 0 or not isinstance(value[1], str) or not value[1].isdigit()):
        raise RuntimeError("Invalid isolated worker identity")
    return value


def started_host(identifier, sha, image, run):
    _, ingest = hosts(run)
    if (len(ingest) != 1 or ingest[0]["id"] != identifier
            or ingest[0].get("state") != "started"
            or image_identity(ingest[0]) != image
            or ingest[0]["config"].get("env", {}).get("GIT_SHA") != sha):
        raise RuntimeError("Isolated worker is not running the accepted release")


def hosts(run):
    machines = json.loads(command(["machines", "list", "--json"], run=run))
    if not isinstance(machines, list):
        raise RuntimeError("Invalid Machine metadata")
    ingest = [m for m in machines
              if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "ingest"]
    if len(ingest) > 1:
        raise RuntimeError("Only one authorized isolated host is permitted")
    for machine in ingest:
        config = machine["config"]
        guest = config.get("guest", {})
        if (machine.get("region") != "iad" or guest.get("cpu_kind") != "shared"
                or guest.get("cpus") != 4 or guest.get("memory_mb") != 5120
                or config.get("services")):
            raise RuntimeError("Isolated host differs from its authorized size or region")
    return machines, ingest


def image_identity(machine):
    # Fly deploy may store a tag while machine update stores tag@digest. Compare
    # the resolved registry identity and pin that digest, never just the tag.
    ref = machine.get("image_ref", {})
    tag, digest = ref.get("tag"), ref.get("digest")
    if (ref.get("registry") != "registry.fly.io" or ref.get("repository") != APP
            or not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", tag)
            or not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
        raise RuntimeError("Serving image identity is not verified")
    image = "registry.fly.io/" + APP + ":" + tag
    pinned = image + "@" + digest
    if machine.get("config", {}).get("image") not in (image, pinned):
        raise RuntimeError("Configured image differs from its resolved identity")
    return pinned


def serving_image(machines, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Full release SHA is required")
    apps = [m for m in machines
            if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app"]
    if not apps or any(m["config"].get("env", {}).get("GIT_SHA") != sha for m in apps):
        raise RuntimeError("API release is not yet consistent; file host was not updated")
    images = {image_identity(m) for m in apps}
    if len(images) != 1 or not next(iter(images)):
        raise RuntimeError("API image is not consistent")
    image = next(iter(images))
    if not image.startswith("registry.fly.io/" + APP + ":"):
        raise RuntimeError("Only the application's serving registry image is permitted")
    return image


def update(sha, run=subprocess.run, *, sleep=time.sleep):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Full release SHA is required")
    machines, ingest = hosts(run)
    if not ingest:
        return False
    image = serving_image(machines, sha)
    command(["machine", "update", ingest[0]["id"], "--image", image,
             "--env", f"GIT_SHA={sha}", "--yes"], run=run)
    verify(ingest[0]["id"], sha, image, run=run, sleep=sleep)
    return True


def provision(sha, monthly_limit, *, run=subprocess.run, sleep=time.sleep):
    # Quote/account tax were checked today. A later first-time provisioning
    # requires refreshing that evidence; normal releases never call this mode.
    if datetime.now(timezone.utc).date().isoformat() != "2026-10-08":
        raise RuntimeError("Refresh the host quote before a new paid allocation")
    if Decimal(str(monthly_limit)) < Decimal("33.873") or Decimal(str(monthly_limit)) > 35:
        raise RuntimeError("Host quote exceeds the authorized monthly budget")
    machines, ingest = hosts(run)
    image = serving_image(machines, sha)
    if not ingest:
        config = {
            "image": image, "env": {"GIT_SHA": sha},
            # Fly permits at most 2 GiB per shared CPU; 5 GiB needs the 4x preset.
            "guest": {"cpu_kind": "shared", "cpus": 4, "memory_mb": 5120},
            "metadata": {"fly_process_group": "ingest"}, "services": [],
            "restart": {"policy": "always"},
            "init": {"exec": ["/usr/local/bin/uv", "run", "python",
                               "scripts/run_assistant_ingest.py", "--workload", "ingest"]},
        }
        # A stable name plus the existing-host check protects unknown outcomes
        # from duplicate paid allocations. No ports, volumes or spare Machines.
        command(["machine", "run", image, "--machine-config", json.dumps(config),
                 "--name", "kova-assistant-ingest", "--region", "iad"], run=run)
        _, ingest = hosts(run)
        if len(ingest) != 1:
            raise RuntimeError("Provisioned host metadata did not match the approved shape")
    elif image_identity(ingest[0]) != image:
        raise RuntimeError("Update the existing host through the normal release first")
    identifier = ingest[0]["id"]
    return verify(identifier, sha, image, run=run, sleep=sleep)


def verify(identifier, sha, image, *, run=subprocess.run, sleep=time.sleep):
    # Scanner creation is asynchronous at boot. Probe metadata only, never env
    # or application secrets. A failed probe does not create another host.
    try:
        _, ingest = hosts(run)
        if len(ingest) != 1 or ingest[0]["id"] != identifier:
            raise RuntimeError("The known isolated host is no longer present")
        if ingest[0].get("state") == "stopped":
            command(["machine", "start", identifier], run=run)
        for attempt in range(25):
            try:
                digest = remote(identifier,
                                "docker image inspect kova-assistant-parser:1 --format {{.Id}}",
                                timeout=20, run=run)
                if not re.fullmatch(r"sha256:[0-9a-f]{64}\s*", digest):
                    raise RuntimeError("Isolated scanner image is not ready")
                break
            except RuntimeError:
                if attempt == 24:
                    raise
                sleep(20)
        started_host(identifier, sha, image, run)
        print("Isolated scanner image verified", flush=True)
        identity = worker_identity(identifier, run)
        print("Isolated worker identity verified; parser checks starting", flush=True)
        report = remote(identifier, PARSER_COMMAND,
                        timeout=240, run=run, stage="parser checks")
        if set(report.splitlines()) != {"PASS: " + name for name in PARSER_CHECKS}:
            raise RuntimeError("Isolated parser did not complete every required check")
        print("Isolated parser completed every required check", flush=True)
        sleep(30)
        started_host(identifier, sha, image, run)
        if worker_identity(identifier, run) != identity:
            raise RuntimeError("Isolated worker restarted during verification")
    except Exception:
        command(["machine", "stop", identifier], run=run)
        raise
    return identifier


def pause(run=subprocess.run):
    _, ingest = hosts(run)
    # Older images do not accept the new provider enum. Restore their known
    # Cloudflare configuration before boot; paid inference/files stay disabled.
    command(["secrets", "import", "--stage"], run=run,
            input="ASSISTANT_GENERATION_PROVIDER=cloudflare\n"
                  "ASSISTANT_DOCUMENTS_ENABLED=false\n"
                  "ASSISTANT_OPENROUTER_QUALITY_VERIFIED=false\n")
    for machine in ingest:
        command(["machine", "stop", machine["id"]], run=run)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("update", "pause", "provision"))
    parser.add_argument("--sha", default="")
    parser.add_argument("--monthly-limit-usd", type=Decimal, default=Decimal(0))
    args = parser.parse_args()
    try:
        if args.mode == "pause":
            pause()
            print("Paid assistant and file host paused for recovery")
        elif args.mode == "provision":
            provision(args.sha, args.monthly_limit_usd)
            print("One isolated host verified with real parser/OCR/antivirus; files remain gated")
        else:
            print("Existing file host updated" if update(args.sha) else "No file host provisioned")
    except RuntimeError as exc:
        raise SystemExit(str(exc) + "; activation remains blocked") from None
    except Exception:
        raise SystemExit("Assistant host release failed; activation remains blocked") from None

"""Maintain the isolated file host; provisioning is a separate, explicitly budgeted mode."""

import argparse
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

APP = "pos-project-backend"
BACKEND = Path(__file__).resolve().parents[1] / "backend"


def command(args, *, run=subprocess.run, **kwargs):
    result = run(["flyctl", *args, "--app", APP], cwd=BACKEND,
                 capture_output=True, text=True, timeout=360, check=False, **kwargs)
    if result.returncode:
        # The subcommand is public and fixed; stdout/stderr can contain private
        # configuration and must never be copied into CI diagnostics.
        raise RuntimeError("Assistant host command failed: " + " ".join(args[:2]))
    return result.stdout


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


def serving_image(machines, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Full release SHA is required")
    apps = [m["config"] for m in machines
            if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app"]
    if not apps or any(c.get("env", {}).get("GIT_SHA") != sha for c in apps):
        raise RuntimeError("API release is not yet consistent; file host was not updated")
    images = {c.get("image") for c in apps}
    if len(images) != 1 or not next(iter(images)):
        raise RuntimeError("API image is not consistent")
    image = next(iter(images))
    if not image.startswith("registry.fly.io/" + APP + ":"):
        raise RuntimeError("Only the application's serving registry image is permitted")
    return image


def update(sha, run=subprocess.run):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Full release SHA is required")
    machines, ingest = hosts(run)
    if not ingest:
        return False
    image = serving_image(machines, sha)
    command(["machine", "update", ingest[0]["id"], "--image", image,
             "--env", f"GIT_SHA={sha}", "--yes"], run=run)
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
    elif ingest[0]["config"].get("image") != image:
        raise RuntimeError("Update the existing host through the normal release first")
    identifier = ingest[0]["id"]
    # Scanner creation is asynchronous at boot. Probe metadata only, never env
    # or application secrets. A failed probe does not create another host.
    try:
        if ingest[0].get("state") == "stopped":
            command(["machine", "start", identifier], run=run)
        for attempt in range(25):
            try:
                command(["machine", "exec", identifier,
                         "docker image inspect kova-assistant-parser:1 --format {{.Id}}",
                         "--timeout", "20"], run=run)
                break
            except RuntimeError:
                if attempt == 24:
                    raise
                sleep(20)
        command(["machine", "exec", identifier, "python scripts/check_assistant_parser.py",
                 "--timeout", "240"], run=run)
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

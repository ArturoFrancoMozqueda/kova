"""Update an existing isolated file host; never provision or resize a Machine."""

import argparse
import json
import re
import subprocess
from pathlib import Path

APP = "pos-project-backend"
BACKEND = Path(__file__).resolve().parents[1] / "backend"


def command(args, *, run=subprocess.run, **kwargs):
    result = run(["flyctl", *args, "--app", APP], cwd=BACKEND,
                 capture_output=True, text=True, timeout=360, check=False, **kwargs)
    if result.returncode:
        raise RuntimeError("Assistant host operation failed; inspect host metadata privately")
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
                or guest.get("cpus") != 1 or guest.get("memory_mb") != 5120
                or config.get("services")):
            raise RuntimeError("Isolated host differs from its authorized size or region")
    return machines, ingest


def update(sha, run=subprocess.run):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("Full release SHA is required")
    machines, ingest = hosts(run)
    if not ingest:
        return False
    apps = [m["config"] for m in machines
            if m.get("config", {}).get("metadata", {}).get("fly_process_group") == "app"]
    if not apps or any(c.get("env", {}).get("GIT_SHA") != sha for c in apps):
        raise RuntimeError("API release is not yet consistent; file host was not updated")
    images = {c.get("image") for c in apps}
    if len(images) != 1 or not next(iter(images)):
        raise RuntimeError("API image is not consistent")
    command(["machine", "update", ingest[0]["id"], "--image", next(iter(images)),
             "--env", f"GIT_SHA={sha}", "--yes"], run=run)
    return True


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
    parser.add_argument("mode", choices=("update", "pause"))
    parser.add_argument("--sha", default="")
    args = parser.parse_args()
    try:
        if args.mode == "pause":
            pause()
            print("Paid assistant and file host paused for recovery")
        else:
            print("Existing file host updated" if update(args.sha) else "No file host provisioned")
    except Exception:
        raise SystemExit("Assistant host release failed; activation remains blocked") from None

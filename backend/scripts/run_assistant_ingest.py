"""Dedicated Docker host: local socket only, clean daemon env, daily scanner refresh."""

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assistant.ingest_demand import configured, has_work  # noqa: E402
from app.config import settings  # noqa: E402
from scripts.run_assistant_worker import main  # noqa: E402

ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
PARSER = Path(__file__).resolve().parents[1] / "assistant-parser"


def command(args, *, timeout):
    result = subprocess.run(args, env=ENV, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("isolated parser initialization failed")
    return result


class Scanner:
    refreshed_at = None
    retry_at = 0

    def refresh(self):
        if self.refreshed_at is not None and time.monotonic() - self.refreshed_at < 86400:
            return
        if time.monotonic() < self.retry_at:
            raise RuntimeError("scanner refresh paused")
        # Freshclam runs only while building a trusted image, before accepting a
        # file. The file parser itself always runs with --network none.
        # Failed/daily builds must not accumulate layers on the Machine disk.
        # The currently tagged scanner remains available until a fresh build succeeds.
        try:
            command(["docker", "builder", "prune", "--all", "--force"], timeout=120)
            command(["docker", "image", "prune", "--force"], timeout=120)
            command(["docker", "build", "--network", "host", "--no-cache",
                     "--tag", "kova-assistant-parser:1", str(PARSER)], timeout=900)
            command(["docker", "builder", "prune", "--all", "--force"], timeout=120)
            command(["docker", "image", "prune", "--force"], timeout=120)
        except Exception:
            self.retry_at = time.monotonic() + 300
            raise
        self.refreshed_at = time.monotonic()
        logging.getLogger(__name__).info("Isolated scanner image refreshed")


def start_daemon():
    daemon = subprocess.Popen(
        ["dockerd", "--host", "unix:///var/run/docker.sock", "--bridge", "none",
         "--iptables=false", "--ip-forward=false", "--ip-masq=false"],
        env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        if daemon.poll() is not None:
            raise RuntimeError("isolated Docker daemon failed")
        try:
            command(["docker", "info"], timeout=2)
            return daemon
        except (RuntimeError, subprocess.SubprocessError):
            time.sleep(1)
    daemon.terminate()
    raise RuntimeError("isolated Docker daemon did not become ready")


def run():
    docker = None
    scanner = Scanner()

    def prepare():
        nonlocal docker
        if docker is None:
            docker = start_daemon()
        scanner.refresh()

    maintenance = settings.assistant_ingest_verify_until > time.time()
    on_demand = settings.assistant_ingest_on_demand
    if on_demand and not configured():
        raise SystemExit("On-demand ingestion requires a configured wake dispatcher")
    if (on_demand and os.environ.get("FLY_MACHINE_ID")
            and os.environ["FLY_MACHINE_ID"] != settings.assistant_ingest_machine_id):
        raise SystemExit("On-demand ingestion must target its own isolated Machine")
    try:
        if maintenance or not on_demand:
            prepare()
        main(default_workload="ingest", before_iteration=prepare,
             has_work=lambda: maintenance_active() or has_work(),
             idle_seconds=settings.assistant_ingest_idle_seconds if on_demand else None)
    finally:
        if docker is not None:
            docker.terminate()


def maintenance_active():
    return settings.assistant_ingest_verify_until > time.time()


if __name__ == "__main__":
    run()

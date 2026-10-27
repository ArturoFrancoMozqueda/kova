#!/usr/bin/env python3
"""Fail closed unless acceptance runs on a matching Linux AMD64 host/daemon.

This is runner evidence, not hardware attestation. No container, production
service or credential is accessed; only whitelisted host and daemon facts are
reported. Cross-architecture emulation must not substitute for native CI.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
from pathlib import Path

MAX_OUTPUT_BYTES = 128 * 1024
DOCKER_INFO = ["docker", "info", "--format", "{{.OSType}}/{{.Architecture}}"]


class HostError(RuntimeError):
    """A safe, fixed-description verification failure."""


def _command(command, *, run) -> str:
    try:
        result = run(command, check=True, capture_output=True, text=True,
                     timeout=20, env={**os.environ, "LC_ALL": "C"})
        output = result.stdout
        if not isinstance(output, str) or len(output.encode()) > MAX_OUTPUT_BYTES:
            raise HostError("Host evidence output exceeds its bounded format")
        return output
    except (subprocess.SubprocessError, OSError) as from_error:
        raise HostError("Host evidence command failed or timed out") from from_error


def _lscpu(output: str) -> dict:
    try:
        rows = json.loads(output)["lscpu"]
        if not isinstance(rows, list):
            raise ValueError
        fields = {}
        # util-linux may group CPU fields in child rows, depending on version.
        pending = [(row, 0) for row in rows]
        while pending:
            row, depth = pending.pop()
            if depth > 8:
                raise ValueError
            field, data = row["field"], row["data"]
            children = row.get("children", [])
            if not isinstance(children, list):
                raise ValueError
            pending.extend((child, depth + 1) for child in children)
            if field in {"Architecture:", "Vendor ID:", "Model name:", "CPU(s):"}:
                if field in fields or not isinstance(data, str):
                    raise ValueError
                fields[field] = data.strip()
        if fields.get("Architecture:") != "x86_64":
            raise HostError("lscpu does not identify an x86_64 host")
        if fields.get("Vendor ID:") not in {"GenuineIntel", "AuthenticAMD"}:
            raise HostError("CPU vendor does not establish an Intel or AMD host")
        model = fields["Model name:"]
        if (not model or len(model) > 160 or not model.isprintable()
                or re.search(r"qemu|\btcg\b|emulat|rosetta", model, re.IGNORECASE)):
            raise HostError("CPU model is missing or indicates emulation")
        count = fields["CPU(s):"]
        if not re.fullmatch(r"[1-9][0-9]{0,5}", count):
            raise ValueError
        return {"architecture": "x86_64", "vendor": fields["Vendor ID:"],
                "model": model, "logical_cpus": int(count)}
    except (ValueError, TypeError, KeyError) as error:
        raise HostError("lscpu evidence is incomplete or malformed") from error


def check_host(*, run=None, environ=None) -> dict:
    run = subprocess.run if run is None else run
    environ = os.environ if environ is None else environ
    system, machine = platform.system(), platform.machine()
    if system != "Linux" or machine != "x86_64":
        raise HostError("Native AMD64 acceptance requires a Linux x86_64 host")
    ci = any(str(environ.get(key, "")).lower() not in {"", "0", "false"}
             for key in ("CI", "GITHUB_ACTIONS"))
    runner_arch = environ.get("RUNNER_ARCH")
    if (ci or runner_arch is not None) and runner_arch != "X64":
        raise HostError("CI must identify its runner architecture as X64")
    cpu = _lscpu(_command(["lscpu", "--json"], run=run))
    daemon = _command(DOCKER_INFO, run=run).strip()
    if daemon not in {"linux/amd64", "linux/x86_64"}:
        raise HostError("Docker daemon must run Linux AMD64 on the matching host")
    return {"schema": 1, "status": "passed",
            "host": {"os": system, "architecture": machine, "cpu": cpu},
            "docker": {"os": "linux", "architecture": daemon.split("/", 1)[1]},
            "ci": ci, "runner_architecture": runner_arch}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = check_host()
    except Exception as error:  # Safe failure artifact even for unexpected tool errors.
        report = {"schema": 1, "status": "failed", "reason": (
            str(error) if isinstance(error, HostError) else "Host verification failed"
        )}
    try:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    except OSError:
        print("AMD64 host verification failed: cannot write evidence report")
        return 1
    print("AMD64 host verification: " + report["status"])
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Audit the exact shipped/build dependency inventories without installing them.

Python advisories of any severity and npm HIGH/CRITICAL findings block CI.
Image scans include unfixed HIGH/CRITICAL OS and language vulnerabilities.
No vulnerability is suppressed. Network/tool/report errors also fail closed.
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NPM_LOCKS = (
    "frontend/package-lock.json",
    "deploy/cloudflare/package-lock.json",
    "deploy/cloudflare-backend/package-lock.json",
    "deploy/cloudflare-native/package-lock.json",
)
PYTHON_LOCKS = ("backend/uv.lock", "deploy/cloudflare-backend/pylock.toml")
PARSER = "backend/assistant-parser/Dockerfile"
PIP_AUDIT = "pip-audit==2.10.1"
TRIVY = (
    "aquasec/trivy:0.76.1@sha256:"
    "790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"
)
IMAGE_BUILDS = {
    "native": ("backend/Dockerfile.api", "backend"),
    "parser": (PARSER, "backend/assistant-parser"),
}
PIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*==[A-Za-z0-9_.+!-]+\Z")


def inventory_errors(root: Path = ROOT) -> list[str]:
    tracked = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True
    ).stdout.decode().split("\0")
    locks = {p for p in tracked if p.endswith(("package-lock.json", "uv.lock", "pylock.toml"))}
    expected = set(NPM_LOCKS) | set(PYTHON_LOCKS)
    errors = [f"Dependency inventory mismatch: unexpected={sorted(locks - expected)}, "
              f"missing={sorted(expected - locks)}"] if locks != expected else []
    for path in (*NPM_LOCKS, *PYTHON_LOCKS, PARSER):
        if not (root / path).is_file():
            errors.append(f"Missing dependency source: {path}")
    return errors


def python_pins(root: Path = ROOT) -> dict[str, list[str]]:
    result = {}
    for source in PYTHON_LOCKS:
        data = tomllib.loads((root / source).read_text())
        packages = data["package" if source.endswith("uv.lock") else "packages"]
        pins = set()
        for package in packages:
            if package.get("source") == {"virtual": "."} and package["name"] == "pos-backend":
                continue
            pin = f'{package["name"]}=={package["version"]}'
            if not PIN.fullmatch(pin):
                raise ValueError(f"Unreviewed Python package identity in {source}")
            if source.endswith("uv.lock") and "registry" not in package.get("source", {}):
                raise ValueError(f"Unreviewed non-registry dependency in {source}: {package['name']}")
            pins.add(pin)
        if not pins:
            raise ValueError(f"Empty Python inventory: {source}")
        result[source] = sorted(pins)
    # The parser intentionally installs only these pinned direct Python packages.
    # Its complete resolved graph and distribution packages are scanned in-image.
    commands = (root / PARSER).read_text().replace("\\\n", " ").splitlines()
    pins = []
    for line in commands:
        if re.match(r"RUN\s+(?:python\s+-m\s+)?pip\s+install\s", line):
            args = shlex.split(re.sub(r"^RUN\s+(?:python\s+-m\s+)?pip\s+install\s+", "", line))
            for arg in args:
                if arg in {"--no-cache-dir", "--no-deps"}:
                    continue
                if not PIN.fullmatch(arg):
                    raise ValueError("Parser Python installs require explicit name==version pins")
                pins.append(arg)
        elif re.search(r"\bpip\s+install\b", line):
            raise ValueError("Unrecognized parser pip install; inventory requires a standalone RUN")
    if not pins:
        raise ValueError("Missing parser Python dependency inventory")
    result[PARSER] = sorted(set(pins))
    return result


def _run(command: list[str], **kwargs) -> bool:
    return subprocess.run(command, cwd=ROOT, check=False, **kwargs).returncode == 0


def python_report_passed(report: Path, expected: list[str]) -> bool:
    try:
        dependencies = json.loads(report.read_text())["dependencies"]
        actual = [f'{item["name"]}=={item["version"]}' for item in dependencies]
        return sorted(actual) == sorted(expected) and all(
            not item.get("skip_reason") and item["vulns"] == [] for item in dependencies
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def npm_report_passed(report: Path) -> bool:
    try:
        data = json.loads(report.read_text())
        counts = data["metadata"]["vulnerabilities"]
        return not data.get("error") and counts["high"] == 0 and counts["critical"] == 0
    except (OSError, ValueError, KeyError, TypeError):
        return False


def image_report_passed(report: Path) -> bool:
    try:
        data = json.loads(report.read_text())
        results = data["Results"]
        classes = {item["Class"] for item in results}
        return (
            data["SchemaVersion"] == 2
            and data["ArtifactType"] == "container_image"
            and {"os-pkgs", "lang-pkgs"} <= classes
            and all(vuln["Severity"] not in {"HIGH", "CRITICAL"}
                    for item in results for vuln in item.get("Vulnerabilities", []))
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def audit_python(output: Path) -> bool:
    success = True
    for index, (source, pins) in enumerate(python_pins().items()):
        print(f"Python advisory scan: {source} ({len(pins)} exact versions)", flush=True)
        with tempfile.TemporaryDirectory(prefix="kova-python-audit-") as directory:
            requirements = Path(directory) / "requirements.txt"
            requirements.write_text("\n".join(pins) + "\n")
            report = output / f"python-{index}.json"
            passed = _run([
                "uv", "tool", "run", "--from", PIP_AUDIT, "pip-audit",
                "--no-deps", "--disable-pip", "--requirement", str(requirements),
                "--format", "json", "--output", str(report), "--progress-spinner", "off",
            ])
            passed = python_report_passed(report, pins) and passed
            success = passed and success
    return success


def audit_npm(output: Path) -> bool:
    success = True
    for index, lock in enumerate(NPM_LOCKS):
        print(f"npm advisory scan: {lock} (all dependencies, HIGH/CRITICAL gate)", flush=True)
        report_path = output / f"npm-{index}.json"
        with report_path.open("w") as report:
            passed = _run([
                "npm", "audit", "--package-lock-only", "--audit-level=high", "--json",
                "--prefix", str(ROOT / Path(lock).parent),
            ], stdout=report)
        success = npm_report_passed(report_path) and passed and success
    return success


def audit_image(name: str, image: str, output: Path) -> bool:
    """Save image locally; scanner gets no Docker socket or deployment credentials."""
    with tempfile.TemporaryDirectory(prefix="kova-image-audit-") as directory:
        archive = Path(directory) / "image.tar"
        if not _run(["docker", "save", "--output", str(archive), image]):
            return False
        report = output / f"image-{name}.json"
        # Stream through the Docker API so local VM daemons never need host
        # filesystem mounts. The shell program is constant, with no user input.
        program = (
            "cat > /tmp/image.tar && exec trivy image --input /tmp/image.tar "
            "--scanners vuln --pkg-types os,library --severity HIGH,CRITICAL "
            "--ignore-unfixed=false --ignorefile /dev/null --exit-code 1 --format json"
        )
        with archive.open("rb") as stream, report.open("w") as result:
            passed = _run([
                "docker", "run", "--rm", "--interactive", "--read-only", "--cap-drop=ALL",
                "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=2g",
                "--volume", "kova-trivy-cache:/root/.cache/trivy",
                "--entrypoint", "/bin/sh", TRIVY, "-c", program,
            ], stdin=stream, stdout=result)
        return image_report_passed(report) and passed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inventory", "python", "npm", "image"))
    parser.add_argument("--output", type=Path, default=Path("reports/security"))
    parser.add_argument("--name", choices=tuple(IMAGE_BUILDS))
    parser.add_argument("--image")
    args = parser.parse_args()
    errors = inventory_errors()
    if errors:
        raise SystemExit("\n".join(errors))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.command == "inventory":
        inventory = {"npm": NPM_LOCKS, "python": python_pins(), "images": IMAGE_BUILDS,
                     "pip_audit": PIP_AUDIT, "trivy": TRIVY}
        (output / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
        print(json.dumps({"npm_locks": len(NPM_LOCKS), "python_sources": 3, "images": 2}))
        return
    if args.command == "image" and (not args.name or not args.image):
        parser.error("image requires --name and --image")
    success = audit_python(output) if args.command == "python" else (
        audit_npm(output) if args.command == "npm" else audit_image(args.name, args.image, output)
    )
    if not success:
        raise SystemExit("Security audit failed: inspect reports; advisory/tool errors block CI")


if __name__ == "__main__":
    main()

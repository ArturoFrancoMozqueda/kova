#!/usr/bin/env python3
"""Build or check the static Kova design-system package."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

from inspect_design_system import build_packet, discover_repo


SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = SKILL_ROOT / "assets/design-system.json"
MARK_OUTPUTS = {
    "mark_on_light": SKILL_ROOT / "assets/kova-mark-dark.svg",
    "mark_on_dark": SKILL_ROOT / "assets/kova-mark-light.svg",
}


def relative(repo: Path, value: str) -> str:
    path = Path(value)
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        return value


def git_revision(repo: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def design_sources(repo: Path) -> list[Path]:
    candidates = [
        repo / "frontend/src/styles.css",
        repo / "frontend/src/landing/landingTheme.tsx",
        repo / "frontend/src/components/brand/Logo.tsx",
        repo / "frontend/public/favicon.svg",
        repo / ".design-sync/config.json",
        repo / ".design-sync/conventions.md",
        repo / ".claude/rules/brand-ux-copy.md",
        repo / "docs/claude/motion-system.md",
    ]
    return [path for path in candidates if path.is_file()]


def source_fingerprint(repo: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(design_sources(repo)):
        digest.update(path.relative_to(repo).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def build_static_package(repo: Path) -> dict[str, object]:
    live = build_packet(repo)
    source_mtimes = {
        relative(repo, path): stamp
        for path, stamp in live["source_modified_at_utc"].items()
        if Path(path).resolve() in {item.resolve() for item in design_sources(repo)}
    }

    return {
        "package_schema_version": 1,
        "package_name": "kova-design-system",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_revision": git_revision(repo),
        "source_fingerprint": source_fingerprint(repo),
        "source_files": [path.relative_to(repo).as_posix() for path in design_sources(repo)],
        "tokens": live["tokens"],
        "typography": live["typography"],
        "component_sources": {
            name: relative(repo, path)
            for name, path in live["component_sources"].items()
        },
        "component_roles": {
            "brand": ["Logo", "LogoMark"],
            "editorial_label": ["ArcKicker", "Badge"],
            "data_story": ["Card", "StatTile", "DeltaChip"],
            "receipt_story": ["TicketPaper", "TicketLeaderRow"],
            "live_state": ["CountUp", "LivePulse"],
        },
        "bundled_assets": {
            "mark_on_light": "assets/kova-mark-dark.svg",
            "mark_on_dark": "assets/kova-mark-light.svg",
        },
        "source_modified_at_utc": source_mtimes,
        "warnings_at_refresh": live["warnings"],
    }


def semantic_payload(package: dict[str, object]) -> dict[str, object]:
    """Return fields that must match even when timestamps or Git HEAD change."""
    keys = (
        "package_schema_version",
        "package_name",
        "source_fingerprint",
        "source_files",
        "tokens",
        "typography",
        "component_sources",
        "component_roles",
        "bundled_assets",
        "warnings_at_refresh",
    )
    return {key: package.get(key) for key in keys}


def build_mark_svg(repo: Path, *, circuit_color: str, core_color: str) -> str:
    """Color the official SVG geometry with the packaged light/dark tokens."""
    source = repo / "frontend/public/favicon.svg"
    tree = ET.parse(source)
    root = tree.getroot()
    view_box = [float(value) for value in root.attrib["viewBox"].split()]
    center = (view_box[0] + view_box[2] / 2, view_box[1] + view_box[3] / 2)
    core_nodes = []

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "path" and element.get("stroke", "none") != "none":
            element.set("stroke", circuit_color)
        if tag != "circle":
            continue
        position = (float(element.attrib["cx"]), float(element.attrib["cy"]))
        if position == center:
            element.set("fill", core_color)
            core_nodes.append(element)
        else:
            element.set("fill", circuit_color)

    if len(core_nodes) != 1:
        raise ValueError("Official mark must contain exactly one circle at the viewBox center")

    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.indent(tree, space="  ")
    return ET.tostring(root, encoding="unicode", short_empty_elements=True) + "\n"


def expected_marks(repo: Path, package: dict[str, object]) -> dict[Path, str]:
    brand = package["tokens"]["brand"]
    return {
        MARK_OUTPUTS["mark_on_light"]: build_mark_svg(
            repo,
            circuit_color=brand["--kova-ink"],
            core_color=brand["--kova-blue"],
        ),
        MARK_OUTPUTS["mark_on_dark"]: build_mark_svg(
            repo,
            circuit_color=brand["--kova-on-ink"],
            core_color=brand["--kova-blue-light"],
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Refresh or check Kova's packaged design-system snapshot."
    )
    parser.add_argument("--repo", help="Path to the Kova repository root.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="Replace the packaged JSON.")
    mode.add_argument("--check", action="store_true", help="Fail when the package is stale.")
    args = parser.parse_args()

    try:
        repo = discover_repo(args.repo)
        package = build_static_package(repo)
        marks = expected_marks(repo, package)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError, ValueError, ET.ParseError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.check:
        if not DEFAULT_OUTPUT.is_file():
            print("stale: packaged design system is missing")
            return 1
        try:
            current = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"error: cannot read packaged design system: {exc}", file=sys.stderr)
            return 2
        if semantic_payload(current) != semantic_payload(package):
            print("stale: packaged design-system content differs; run with --write")
            return 1
        for path, expected in marks.items():
            if not path.is_file() or path.read_text(encoding="utf-8") != expected:
                print(f"stale: bundled mark differs: {path.name}; run with --write")
                return 1
        print("current: packaged design system matches the repository")
        return 0

    if args.write:
        DEFAULT_OUTPUT.write_text(
            json.dumps(package, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for path, content in marks.items():
            path.write_text(content, encoding="utf-8")
        print(f"updated: {DEFAULT_OUTPUT} and {len(MARK_OUTPUTS)} bundled marks")
        return 0

    print(json.dumps(package, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Emit a compact, read-only design-system packet from a Kova checkout."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_MARKERS = (
    Path("AGENTS.md"),
    Path("frontend/src/styles.css"),
    Path(".design-sync/config.json"),
)

TOKEN_RE = re.compile(
    r"^\s*(--(?:kova-[a-z0-9-]+|radius-kova-[a-z0-9-]+))\s*:\s*([^;]+);",
    re.IGNORECASE | re.MULTILINE,
)
SKILL_ROOT = Path(__file__).resolve().parents[1]


def is_kova_root(path: Path) -> bool:
    return all((path / marker).is_file() for marker in REQUIRED_MARKERS)


def discover_repo(explicit: str | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    env_root = os.environ.get("KOVA_REPO_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.append(Path.cwd())

    seen: set[Path] = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        for path in (candidate, *candidate.parents):
            if path in seen:
                continue
            seen.add(path)
            if is_kova_root(path):
                return path

    raise FileNotFoundError(
        "No Kova checkout found. Run inside the repository, pass --repo, "
        "or set KOVA_REPO_ROOT."
    )


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def compact_css_value(value: str) -> str:
    value = re.sub(r"/\*.*?\*/", "", value, flags=re.DOTALL)
    return " ".join(value.split())


def modified_at(path: Path) -> str:
    stamp = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return stamp.isoformat(timespec="seconds")


def existing_files(paths: list[Path]) -> list[str]:
    return [str(path.resolve()) for path in paths if path.is_file()]


def build_packet(repo: Path) -> dict[str, object]:
    styles_path = repo / "frontend/src/styles.css"
    landing_theme_path = repo / "frontend/src/landing/landingTheme.tsx"
    config_path = repo / ".design-sync/config.json"
    conventions_path = repo / ".design-sync/conventions.md"

    styles = read_text(styles_path)
    landing_theme = read_text(landing_theme_path) if landing_theme_path.is_file() else ""
    config = json.loads(read_text(config_path))

    tokens: dict[str, str] = {}
    for name, value in TOKEN_RE.findall(styles):
        tokens[name] = compact_css_value(value)

    token_groups = {
        "brand": {
            key: value
            for key, value in tokens.items()
            if not any(
                marker in key
                for marker in ("-dur-", "-ease-", "-shadow-", "-grad-")
            )
            and not key.startswith("--radius-")
        },
        "radii": {key: value for key, value in tokens.items() if key.startswith("--radius-")},
        "shadows": {key: value for key, value in tokens.items() if "-shadow-" in key},
        "gradients": {key: value for key, value in tokens.items() if "-grad-" in key},
        "motion": {
            key: value
            for key, value in tokens.items()
            if "-dur-" in key or "-ease-" in key
        },
    }

    body_font_match = re.search(r"font-family:\s*([^;]+);", landing_theme)
    display_font_match = re.search(r"--lp-font-display:\s*([^;]+);", landing_theme)
    typography = {
        "body": body_font_match.group(1).strip() if body_font_match else None,
        "display": display_font_match.group(1).strip() if display_font_match else None,
    }

    component_sources: dict[str, str] = {}
    for name, relative in config.get("componentSrcMap", {}).items():
        source = repo / "frontend" / relative
        component_sources[name] = str(source.resolve())

    reference_paths = {
        "design_conventions": conventions_path,
        "brand_copy_rules": repo / ".claude/rules/brand-ux-copy.md",
        "product_context": repo / "docs/claude/product-context.md",
        "motion_system": repo / "docs/claude/motion-system.md",
        "logo_source": repo / "frontend/src/components/brand/Logo.tsx",
        "logo_asset": repo / "frontend/public/favicon.svg",
        "landing_theme": landing_theme_path,
        "marketing_research": repo
        / "docs/marketing/analisis-organico-competidores-2026-09-11.md",
    }

    source_files = [styles_path, config_path]
    source_files.extend(path for path in reference_paths.values() if path.is_file())
    freshness = {str(path.resolve()): modified_at(path) for path in source_files}

    warnings: list[str] = []
    if conventions_path.is_file():
        conventions = read_text(conventions_path)
        canonical_blue = token_groups["brand"].get("--kova-blue")
        blue_line = next(
            (line for line in conventions.splitlines() if "kova-blue" in line and "#" in line),
            None,
        )
        if canonical_blue and blue_line and canonical_blue.lower() not in blue_line.lower():
            warnings.append(
                ".design-sync/conventions.md mentions a different kova-blue value; "
                "frontend/src/styles.css is authoritative."
            )
        radii_line = next(
            (line for line in conventions.splitlines() if line.startswith("| Radii |")),
            None,
        )
        canonical_radii = set(token_groups["radii"].values())
        documented_radii = set(re.findall(r"\b\d+px\b", radii_line or ""))
        if radii_line and canonical_radii != documented_radii:
            warnings.append(
                ".design-sync/conventions.md lists different Kova radii; "
                "frontend/src/styles.css is authoritative."
            )

    packet = {
        "schema_version": 1,
        "repo_root": str(repo.resolve()),
        "authority": [
            str(styles_path.resolve()),
            str(landing_theme_path.resolve()),
            str(config_path.resolve()),
            str(conventions_path.resolve()),
        ],
        "tokens": token_groups,
        "typography": typography,
        "component_sources": component_sources,
        "references": {
            name: str(path.resolve())
            for name, path in reference_paths.items()
            if path.is_file()
        },
        "assets": {
            "official_marks": existing_files(
                [
                    repo / "frontend/public/favicon.svg",
                    repo / "frontend/public/email/kova-mark.png",
                ]
            ),
            "approved_media_manifest": str(
                (SKILL_ROOT / "assets/media-library.json").resolve()
            ),
        },
        "source_modified_at_utc": freshness,
        "warnings": warnings,
    }
    return packet


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect Kova's live design system without modifying the repository."
    )
    parser.add_argument("--repo", help="Path to the Kova repository root.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print the JSON packet.")
    args = parser.parse_args()

    try:
        repo = discover_repo(args.repo)
        packet = build_packet(repo)
    except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(packet, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

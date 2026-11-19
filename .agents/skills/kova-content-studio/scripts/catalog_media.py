#!/usr/bin/env python3
"""Rank raster images by compatibility with a target aspect ratio."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True

try:
    from PIL import Image, UnidentifiedImageError
except ImportError as exc:  # pragma: no cover - environment-dependent guidance
    raise SystemExit(
        "error: Pillow is required to inspect raster dimensions; use the bundled "
        "Codex Python runtime or inspect the files with an image tool"
    ) from exc


SUPPORTED = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"}
SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = SKILL_ROOT / "assets/media-library.json"


def parse_target(value: str) -> tuple[int, int]:
    normalized = value.lower().replace(":", "x")
    try:
        width_text, height_text = normalized.split("x", maxsplit=1)
        width, height = int(width_text), int(height_text)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("target must look like 1080x1920 or 9:16") from exc
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("target dimensions must be positive")
    return width, height


def orientation(width: int, height: int) -> str:
    if width == height:
        return "square"
    return "portrait" if height > width else "landscape"


def discover(inputs: list[str]) -> list[Path]:
    found: set[Path] = set()
    for raw in inputs:
        path = Path(raw).expanduser().resolve()
        if path.is_file() and path.suffix.lower() in SUPPORTED:
            found.add(path)
        elif path.is_dir():
            found.update(
                item.resolve()
                for item in path.rglob("*")
                if item.is_file() and item.suffix.lower() in SUPPORTED
            )
        else:
            print(f"warning: skipped missing or unsupported path: {path}", file=sys.stderr)
    return sorted(found)


def find_repo(explicit: str | None) -> Path:
    candidates = [Path(explicit).expanduser()] if explicit else []
    if os.environ.get("KOVA_REPO_ROOT"):
        candidates.append(Path(os.environ["KOVA_REPO_ROOT"]).expanduser())
    candidates.append(Path.cwd())
    for candidate in candidates:
        candidate = candidate.resolve()
        for path in (candidate, *candidate.parents):
            if (path / "AGENTS.md").is_file() and (path / "frontend").is_dir():
                return path
    raise FileNotFoundError(
        "No Kova checkout found. Run inside the repository, pass --repo, "
        "or set KOVA_REPO_ROOT."
    )


def load_manifest_selection(
    manifest_path: Path,
    repo: Path,
    pool: str,
    target: tuple[int, int],
) -> tuple[list[Path], dict[Path, dict[str, object]], dict[str, object], str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selected_pool = orientation(*target) if pool == "auto" else pool
    pool_data = manifest.get("pools", {}).get(selected_pool)
    if not isinstance(pool_data, dict):
        raise ValueError(f"Manifest has no pool named {selected_pool!r}")

    paths: list[Path] = []
    metadata: dict[Path, dict[str, object]] = {}
    pool_metadata = {
        "role": pool_data.get("role"),
        "usage": pool_data.get("usage"),
        "fit": pool_data.get("fit"),
        "selection_priority": pool_data.get("directory_priority", 0),
    }
    for raw_directory in pool_data.get("directories", []):
        directory = (repo / raw_directory).resolve()
        for path in discover([str(directory)]):
            paths.append(path)
            metadata[path] = {key: value for key, value in pool_metadata.items() if value}
    for entry in pool_data.get("assets", []):
        if not entry.get("approved", False):
            continue
        path = (repo / entry["path"]).resolve()
        paths.append(path)
        metadata[path] = {
            "role": entry.get("role"),
            "usage": entry.get("usage"),
            "fit": entry.get("fit"),
            "selection_priority": entry.get(
                "priority", pool_data.get("asset_priority", 0)
            ),
        }
    return sorted(set(paths)), metadata, manifest.get("selection_policy", {}), selected_pool


def inspect(
    path: Path,
    target: tuple[int, int],
    metadata: dict[str, object] | None = None,
) -> dict[str, object] | None:
    try:
        with Image.open(path) as image:
            width, height = image.size
    except (OSError, UnidentifiedImageError) as exc:
        print(f"warning: could not inspect {path}: {exc}", file=sys.stderr)
        return None

    target_width, target_height = target
    source_ratio = width / height
    target_ratio = target_width / target_height
    crop_retained = min(source_ratio / target_ratio, target_ratio / source_ratio)
    source_orientation = orientation(width, height)
    target_orientation = orientation(target_width, target_height)
    same_orientation = source_orientation == target_orientation

    if same_orientation and crop_retained >= 0.80:
        recommendation = "preferred"
        rank = 0
    elif same_orientation:
        recommendation = "usable_with_crop_review"
        rank = 1
    else:
        recommendation = "fallback_other_orientation"
        rank = 2

    row = {
        "path": str(path),
        "width": width,
        "height": height,
        "orientation": source_orientation,
        "aspect_ratio": round(source_ratio, 4),
        "crop_retained": round(crop_retained, 4),
        "recommendation": recommendation,
        "_orientation_rank": 0 if same_orientation else 1,
        "_rank": rank,
    }
    if metadata:
        row.update(metadata)
    return row


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rank approved raster media for a target output orientation."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="User-approved image files or directories. When omitted, use the manifest.",
    )
    parser.add_argument(
        "--target",
        required=True,
        type=parse_target,
        metavar="WIDTHxHEIGHT",
        help="Target dimensions or ratio, for example 1080x1920 or 16:9.",
    )
    parser.add_argument("--repo", help="Path to the Kova repository root.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="Approved media manifest. Defaults to the skill's assets/media-library.json.",
    )
    parser.add_argument(
        "--pool",
        choices=("auto", "portrait", "landscape", "square", "product_ui"),
        default="auto",
        help="Manifest pool. Auto chooses from the target orientation.",
    )
    args = parser.parse_args()

    try:
        if args.paths:
            selected_paths = discover(args.paths)
            metadata: dict[Path, dict[str, object]] = {}
            policy: dict[str, object] = {"source": "user_supplied_paths"}
            selected_pool = "user_supplied"
        else:
            repo = find_repo(args.repo)
            selected_paths, metadata, policy, selected_pool = load_manifest_selection(
                args.manifest.resolve(), repo, args.pool, args.target
            )
    except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    rows = [inspect(path, args.target, metadata.get(path)) for path in selected_paths]
    ranked = [row for row in rows if row is not None]
    if (
        not args.paths
        and selected_pool in {"portrait", "landscape", "square"}
        and policy.get("reject_wrong_orientation_in_named_pool", False)
    ):
        mismatched = [row for row in ranked if row["orientation"] != selected_pool]
        for row in mismatched:
            print(
                f"warning: rejected wrong-orientation file from {selected_pool} pool: "
                f"{row['path']}",
                file=sys.stderr,
            )
        ranked = [row for row in ranked if row["orientation"] == selected_pool]
    ranked.sort(
        key=lambda row: (
            row["_orientation_rank"],
            row.get("selection_priority", 0),
            row["_rank"],
            -row["crop_retained"],
            row["path"],
        )
    )
    for row in ranked:
        row.pop("_orientation_rank")
        row.pop("_rank")

    payload = {
        "target": {
            "width": args.target[0],
            "height": args.target[1],
            "orientation": orientation(*args.target),
            "aspect_ratio": round(args.target[0] / args.target[1], 4),
        },
        "selection_source": "explicit_paths" if args.paths else str(args.manifest.resolve()),
        "pool": selected_pool,
        "policy": policy,
        "media": ranked,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if ranked else 1


if __name__ == "__main__":
    raise SystemExit(main())

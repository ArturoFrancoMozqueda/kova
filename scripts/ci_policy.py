#!/usr/bin/env python3
"""Conservative change classification and the single required CI result.

Unknown files or an unavailable diff run everything. No test selection occurs
inside a suite. Inputs come from GitHub's commit IDs and needs results.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def classify(paths: list[str] | None, *, main: bool = False) -> dict[str, str]:
    if not paths:
        return dict(code="true", parser="true", supply="true")
    if any(not path.startswith(("docs/", "backend/", "frontend/", "specs/", ".github/",
                                "scripts/", ".claude/"))
           and path not in {"README.md", "CHANGELOG.md"} for path in paths):
        return dict(code="true", parser="true", supply="true")
    docs_only = all(
        path in {"README.md", "CHANGELOG.md"}
        or (path.startswith("docs/") and path.endswith(".md"))
        for path in paths
    )
    infrastructure = any(
        path.startswith((".github/", "scripts/", "backend/scripts/"))
        or "docker" in path.lower()
        or path.endswith(("fly.toml", "vercel.json"))
        for path in paths
    )
    dependencies = any(
        path.endswith(("package.json", "package-lock.json", "pyproject.toml", "uv.lock"))
        for path in paths
    )
    parser = main or infrastructure or dependencies or any(
        path.startswith(("backend/app/assistant/", "backend/assistant-parser/",
                         "frontend/src/assistant/", "backend/app/tests/test_assistant"))
        or path == "backend/app/config.py"
        for path in paths
    )
    supply = infrastructure or dependencies
    return {key: str(value).lower() for key, value in
            {"code": not docs_only, "parser": parser and not docs_only,
             "supply": supply and not docs_only}.items()}


def gate_errors(policy: dict[str, str], needs: dict) -> list[str]:
    expected = {
        "changes": True,
        "repository": True,
        "security": True,
        "backend-integration": policy.get("code") == "true",
        "frontend": policy.get("code") == "true",
        "integration": policy.get("code") == "true",
        "migrations": policy.get("code") == "true",
        "assistant-parser": policy.get("parser") == "true",
        "supply-chain": policy.get("supply") == "true",
    }
    errors = []
    if set(policy) != {"code", "parser", "supply"} or any(
        value not in {"true", "false"} for value in policy.values()
    ):
        errors.append("missing or invalid change policy")
    for job, required in expected.items():
        result = needs.get(job, {}).get("result")
        allowed = {"success"} if required else {"success", "skipped"}
        if result not in allowed:
            errors.append(f"{job}: {result or 'missing'} (expected {sorted(allowed)})")
    return errors


def changed_paths(base: str, head: str) -> list[str] | None:
    # First push, shallow checkout, missing/deleted base: fail closed.
    if not base or set(base) == {"0"}:
        return None
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "-z", base, head, "--"],
            check=True, capture_output=True,
        )
    except subprocess.CalledProcessError:
        return None
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["changes", "gate"])
    args = parser.parse_args()
    if args.command == "gate":
        errors = gate_errors(json.loads(os.environ["CI_POLICY"]),
                             json.loads(os.environ["CI_NEEDS"]))
        if errors:
            raise SystemExit("\n".join(errors))
        print("CI required: all applicable checks passed")
        return
    policy = classify(changed_paths(os.environ.get("CI_BASE", ""),
                                    os.environ["CI_HEAD"]),
                      main=os.environ.get("GITHUB_EVENT_NAME") == "push")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key, value in policy.items():
            output.write(f"{key}={value}\n")
    print(json.dumps(policy, sort_keys=True))


if __name__ == "__main__":
    main()

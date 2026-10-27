#!/usr/bin/env python3
"""Conservative change classification and the single required CI result.

Unknown files or an unavailable diff run everything. No test selection occurs
inside a suite. Inputs come from GitHub's commit IDs and needs results. A main
push may reuse suites only when a same-repository pull request run already
passed on the identical tree; any doubt runs everything.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path


KEYS = ("code", "backend", "frontend", "parser", "supply", "reused")
VERIFIED_TREE = "ci-verified-tree"


def _docs(path: str) -> bool:
    return path in {"README.md", "CHANGELOG.md"} or (
        path.startswith("docs/") and path.endswith(".md"))


def classify(paths: list[str] | None, *, main: bool = False) -> dict[str, str]:
    if not paths:
        return dict.fromkeys(KEYS, "true") | {"reused": "false"}
    if any(not path.startswith(("docs/", "backend/", "frontend/", "specs/", ".github/",
                                "scripts/", ".claude/"))
           and path not in {"README.md", "CHANGELOG.md"} for path in paths):
        return dict.fromkeys(KEYS, "true") | {"reused": "false"}
    docs_only = all(_docs(path) for path in paths)
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
    # A side may skip only when every changed path is docs or owned by the
    # other side; shared paths (specs/, .claude/, non-Markdown docs) run both.
    shared = main or infrastructure or dependencies or any(
        not _docs(path) and not path.startswith(("backend/", "frontend/"))
        for path in paths
    )
    backend = shared or any(path.startswith("backend/") for path in paths)
    frontend = shared or any(path.startswith("frontend/") for path in paths)
    parser = main or infrastructure or dependencies or any(
        path.startswith(("backend/app/assistant/", "backend/assistant-parser/",
                         "frontend/src/assistant/", "backend/app/tests/test_assistant"))
        or path == "backend/app/config.py"
        for path in paths
    )
    supply = infrastructure or dependencies
    return {key: str(value and not docs_only).lower() for key, value in
            {"code": True, "backend": backend, "frontend": frontend,
             "parser": parser, "supply": supply}.items()} | {"reused": "false"}


def reuse(policy: dict[str, str]) -> dict[str, str]:
    """Skip suites a pull request already passed on this exact tree.

    Security, the assistant parser and supply-chain checks keep their own
    policy; release still requires `code`.
    """
    if policy.get("code") != "true":
        return policy
    return policy | {"backend": "false", "frontend": "false", "reused": "true"}


def verified_tree_matches(head_tree: str, repo: str, api, download) -> bool:
    """True only for one merged same-repo PR whose successful CI run uploaded
    the tree it tested and that tree equals `head_tree`. Errors return False."""
    try:
        pulls = [pull for pull in api(f"repos/{repo}/commits/{os.environ['CI_HEAD']}/pulls")
                 if pull.get("merged_at") and pull["base"]["ref"] == "main"
                 and (pull["head"].get("repo") or {}).get("full_name") == repo]
        if len(pulls) != 1:
            return False
        runs = api(f"repos/{repo}/actions/workflows/ci.yml/runs?event=pull_request"
                   f"&head_sha={pulls[0]['head']['sha']}&per_page=20")["workflow_runs"]
        for run in runs:
            if (run.get("conclusion") != "success"
                    or run.get("path") != ".github/workflows/ci.yml"
                    or (run.get("head_repository") or {}).get("full_name") != repo):
                continue
            tested = download(run["id"])
            if tested is not None and tested == head_tree:
                return True
        return False
    except Exception:  # noqa: BLE001 - any API doubt runs every suite.
        return False


def _gh_api(path: str):
    result = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def _download_tree(run_id: int) -> str | None:
    with tempfile.TemporaryDirectory() as directory:
        result = subprocess.run(
            ["gh", "run", "download", str(run_id), "--name", VERIFIED_TREE,
             "--dir", directory, "--repo", os.environ["GITHUB_REPOSITORY"]],
            capture_output=True,
        )
        tree_file = Path(directory) / "tree.txt"
        if result.returncode != 0 or not tree_file.is_file():
            return None
        tree = tree_file.read_text().strip()
        return tree if len(tree) == 40 and set(tree) <= set("0123456789abcdef") else None


def _head_tree(head: str) -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", f"{head}^{{tree}}"], check=True,
                              capture_output=True, text=True).stdout.strip()
    except subprocess.CalledProcessError:
        return None


def gate_errors(policy: dict[str, str], needs: dict) -> list[str]:
    expected = {
        "changes": True,
        "repository": True,
        "security": True,
        "backend-integration": policy.get("backend") == "true",
        "backend-workers": policy.get("backend") == "true",
        "backend-native": policy.get("backend") == "true",
        "frontend": policy.get("frontend") == "true",
        "frontend-unit": policy.get("frontend") == "true",
        "integration": policy.get("code") == "true" and policy.get("reused") != "true",
        "migrations": policy.get("backend") == "true",
        "assistant-parser": policy.get("parser") == "true",
        "supply-chain": policy.get("supply") == "true",
    }
    errors = []
    if set(policy) != set(KEYS) or any(
        value not in {"true", "false"} for value in policy.values()
    ):
        errors.append("missing or invalid change policy")
    for job, required in expected.items():
        result = needs.get(job, {}).get("result")
        allowed = {"success"} if required else {"success", "skipped"}
        if result not in allowed:
            errors.append(f"{job}: {result or 'missing'} (expected {sorted(allowed)})")
    for job in needs.keys() - expected.keys():
        if needs[job].get("result") != "success":
            errors.append(f"{job}: unplanned non-success result")
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
    push = os.environ.get("GITHUB_EVENT_NAME") == "push"
    policy = classify(changed_paths(os.environ.get("CI_BASE", ""),
                                    os.environ["CI_HEAD"]), main=push)
    head_tree = _head_tree(os.environ["CI_HEAD"]) if push else None
    if head_tree and verified_tree_matches(head_tree, os.environ["GITHUB_REPOSITORY"],
                                           _gh_api, _download_tree):
        policy = reuse(policy)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for key, value in policy.items():
            output.write(f"{key}={value}\n")
    print(json.dumps(policy, sort_keys=True))


if __name__ == "__main__":
    main()

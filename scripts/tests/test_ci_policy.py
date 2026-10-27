import importlib.util
import os
import unittest
from unittest import mock
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "ci_policy", Path(__file__).resolve().parents[1] / "ci_policy.py"
)
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class PolicyTests(unittest.TestCase):
    def test_docs_only_skip_suites_even_on_main(self):
        self.assertEqual(POLICY.classify(["docs/deployment.md", "README.md"], main=True),
                         dict(code="false", backend="false", frontend="false",
                              parser="false", supply="false", reused="false"))

    def test_unknown_paths_and_missing_diff_run_suites(self):
        for paths in [None, [], ["new-runtime"], ["docs/check.sh"], ["AGENTS.md"]]:
            self.assertEqual(POLICY.classify(paths)["code"], "true")
        for paths in [None, ["new-runtime"], ["deploy/cloudflare/worker.mjs"]]:
            self.assertEqual(POLICY.classify(paths),
                             dict(code="true", backend="true", frontend="true",
                                  parser="true", supply="true", reused="false"))

    def test_code_keeps_full_suites_and_main_parser(self):
        for path in ["frontend/src/App.tsx", "backend/app/orders/service.py",
                     "backend/alembic/versions/0080.py"]:
            self.assertEqual(POLICY.classify([path])["code"], "true")
            self.assertEqual(POLICY.classify([path], main=True)["parser"], "true")

    def test_one_sided_changes_skip_only_the_other_side(self):
        frontend = POLICY.classify(["frontend/src/App.tsx", "docs/ux.md"])
        self.assertEqual((frontend["code"], frontend["frontend"], frontend["backend"]),
                         ("true", "true", "false"))
        backend = POLICY.classify(["backend/app/orders/service.py", "README.md"])
        self.assertEqual((backend["code"], backend["backend"], backend["frontend"]),
                         ("true", "true", "false"))
        both = POLICY.classify(["frontend/src/App.tsx", "backend/app/main.py"])
        self.assertEqual((both["backend"], both["frontend"]), ("true", "true"))

    def test_shared_paths_main_and_tooling_run_both_sides(self):
        for paths, main in [(["frontend/src/App.tsx"], True),
                            (["backend/app/main.py"], True),
                            (["specs/openapi.json"], False),
                            ([".claude/rules/backend.md"], False),
                            (["docs/check.sh"], False),
                            (["frontend/package-lock.json"], False),
                            (["backend/uv.lock"], False),
                            (["backend/Dockerfile"], False),
                            (["frontend/Dockerfile"], False),
                            (["backend/scripts/provision_app_role.sql"], False),
                            (["scripts/ci_policy.py"], False),
                            ([".github/workflows/ci.yml"], False)]:
            policy = POLICY.classify(paths, main=main)
            self.assertEqual((policy["backend"], policy["frontend"]), ("true", "true"),
                             (paths, main))

    def test_parser_dependencies_and_infrastructure(self):
        for path in ["backend/app/assistant/worker.py", "backend/assistant-parser/Dockerfile",
                     "backend/uv.lock", "frontend/package-lock.json", ".github/workflows/ci.yml",
                     "backend/scripts/check_assistant_parser.py", "backend/app/config.py"]:
            self.assertEqual(POLICY.classify([path])["parser"], "true", path)
        for path in ["backend/Dockerfile", "backend/uv.lock", ".github/workflows/ci.yml"]:
            self.assertEqual(POLICY.classify([path])["supply"], "true", path)

    def test_mixed_docs_and_code_run_suites(self):
        self.assertEqual(POLICY.classify(["README.md", "frontend/src/App.tsx"])["code"],
                         "true")

    def test_gate_accepts_only_planned_skips(self):
        policy = POLICY.classify(["README.md"])
        needs = {job: {"result": "success"} for job in
                 ["changes", "repository", "security"]}
        for job in ["backend-integration", "backend-workers", "backend-native", "frontend", "frontend-unit", "integration", "migrations",
                    "assistant-parser", "supply-chain"]:
            needs[job] = {"result": "skipped"}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for result in ["failure", "cancelled", None]:
            needs["frontend"] = {"result": result}
            self.assertTrue(POLICY.gate_errors(policy, needs))

    def test_gate_rejects_failure_cancellation_or_missing_required_job(self):
        policy = POLICY.classify(None)
        jobs = ["changes", "repository", "security", "backend-integration", "backend-workers", "backend-native", "frontend", "frontend-unit",
                "integration", "migrations", "assistant-parser", "supply-chain"]
        for job in jobs:
            for result in ["failure", "cancelled", "skipped", None]:
                needs = {name: {"result": "success"} for name in jobs}
                needs[job] = {"result": result}
                self.assertTrue(POLICY.gate_errors(policy, needs), (job, result))

    def test_code_gate_accepts_optional_supply_skip_but_not_failed_required_suites(self):
        policy = POLICY.classify(["backend/app/assistant/generation.py"], main=True)
        needs = {job: {"result": "success"} for job in
                 ["changes", "repository", "security", "backend-integration", "backend-workers", "backend-native", "frontend",
                  "frontend-unit", "integration", "migrations", "assistant-parser"]}
        needs["supply-chain"] = {"result": "skipped"}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for result in ("failure", "cancelled", "skipped", None):
            needs["backend-integration"] = {"result": result}
            self.assertTrue(POLICY.gate_errors(policy, needs))

    def test_frontend_only_gate_accepts_backend_skips_but_requires_frontend(self):
        policy = POLICY.classify(["frontend/src/App.tsx"])
        backend_jobs = ["backend-integration", "backend-workers", "backend-native", "migrations"]
        needs = {job: {"result": "success"} for job in
                 ["changes", "repository", "security", "frontend", "frontend-unit",
                  "integration"]}
        needs |= {job: {"result": "skipped"} for job in
                  backend_jobs + ["assistant-parser", "supply-chain"]}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for job in ["frontend", "frontend-unit", "integration"]:
            for result in ("failure", "cancelled", "skipped", None):
                broken = needs | {job: {"result": result}}
                self.assertTrue(POLICY.gate_errors(policy, broken), (job, result))
        for job in backend_jobs:
            broken = needs | {job: {"result": "failure"}}
            self.assertTrue(POLICY.gate_errors(policy, broken), job)

    def test_backend_only_gate_requires_backend_suites(self):
        policy = POLICY.classify(["backend/app/orders/service.py"])
        needs = {job: {"result": "success"} for job in
                 ["changes", "repository", "security", "backend-integration",
                  "backend-workers", "backend-native", "migrations", "integration"]}
        needs |= {job: {"result": "skipped"} for job in
                  ["frontend", "frontend-unit", "assistant-parser", "supply-chain"]}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for job in ["backend-integration", "backend-workers", "backend-native", "migrations"]:
            self.assertTrue(POLICY.gate_errors(policy, needs | {job: {"result": "skipped"}}), job)

    def test_legacy_policy_without_sides_cannot_succeed(self):
        needs = {job: {"result": "success"} for job in ["changes", "repository", "security"]}
        self.assertTrue(POLICY.gate_errors(dict(code="true", parser="true", supply="true"), needs))
        self.assertTrue(POLICY.gate_errors(
            dict(code="true", backend="true", frontend="true", parser="true", supply="true"),
            needs))

    def test_reused_main_push_still_requires_security_and_parser(self):
        policy = POLICY.reuse(POLICY.classify(["frontend/src/App.tsx"], main=True))
        self.assertEqual((policy["code"], policy["backend"], policy["frontend"],
                          policy["parser"], policy["reused"]),
                         ("true", "false", "false", "true", "true"))
        needs = {job: {"result": "success"} for job in
                 ["changes", "repository", "security", "assistant-parser"]}
        needs |= {job: {"result": "skipped"} for job in
                  ["backend-integration", "backend-workers", "backend-native", "migrations",
                   "frontend", "frontend-unit", "integration", "supply-chain"]}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for job in ["security", "assistant-parser", "repository"]:
            self.assertTrue(POLICY.gate_errors(policy, needs | {job: {"result": "skipped"}}), job)

    def test_reuse_never_turns_docs_only_into_a_release(self):
        policy = POLICY.classify(["README.md"], main=True)
        self.assertEqual(POLICY.reuse(policy), policy)

    def test_verified_tree_requires_one_same_repo_pr_and_identical_successful_tree(self):
        repo, tree = "owner/kova", "a" * 40
        pull = {"merged_at": "2026-10-26T00:00:00Z", "base": {"ref": "main"},
                "head": {"sha": "b" * 40, "repo": {"full_name": repo}}}
        run = {"id": 7, "conclusion": "success", "path": ".github/workflows/ci.yml",
               "head_repository": {"full_name": repo}}

        def api_for(pulls, runs):
            def api(path):
                if "/pulls" in path:
                    return pulls
                if "head_sha=" + "b" * 40 not in path:
                    raise AssertionError(path)
                return {"workflow_runs": runs}
            return api

        with mock.patch.dict(os.environ, {"CI_HEAD": "c" * 40}):
            check = POLICY.verified_tree_matches
            self.assertTrue(check(tree, repo, api_for([pull], [run]), lambda _: tree))
            fork = pull | {"head": {"sha": "b" * 40, "repo": {"full_name": "evil/kova"}}}
            for pulls, runs, tested in [
                ([], [run], tree),
                ([pull, pull], [run], tree),
                ([fork], [run], tree),
                ([pull | {"merged_at": None}], [run], tree),
                ([pull | {"base": {"ref": "release"}}], [run], tree),
                ([pull], [run | {"conclusion": "failure"}], tree),
                ([pull], [run | {"path": ".github/workflows/other.yml"}], tree),
                ([pull], [run | {"head_repository": {"full_name": "evil/kova"}}], tree),
                ([pull], [run], "d" * 40),
                ([pull], [run], None),
                ([pull], [], tree),
            ]:
                self.assertFalse(check(tree, repo, api_for(pulls, runs), lambda _, t=tested: t),
                                 (pulls, runs, tested))

            def broken(_):
                raise RuntimeError("API unavailable")
            self.assertFalse(check(tree, repo, broken, lambda _: tree))

    def test_invalid_policy_cannot_succeed(self):
        self.assertTrue(POLICY.gate_errors({}, {}))

    def test_new_job_cannot_fail_or_skip_silently(self):
        needs = {"future-check": {"result": "failure"}}
        self.assertIn("future-check: unplanned non-success result",
                      POLICY.gate_errors(POLICY.classify(None), needs))

import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "ci_policy", Path(__file__).resolve().parents[1] / "ci_policy.py"
)
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class PolicyTests(unittest.TestCase):
    def test_docs_only_skip_suites_even_on_main(self):
        self.assertEqual(POLICY.classify(["docs/deployment.md", "README.md"], main=True),
                         dict(code="false", parser="false", supply="false"))

    def test_unknown_paths_and_missing_diff_run_suites(self):
        for paths in [None, [], ["new-runtime"], ["docs/check.sh"], ["AGENTS.md"]]:
            self.assertEqual(POLICY.classify(paths)["code"], "true")
        self.assertEqual(POLICY.classify(None),
                         dict(code="true", parser="true", supply="true"))

    def test_code_keeps_full_suites_and_main_parser(self):
        for path in ["frontend/src/App.tsx", "backend/app/orders/service.py",
                     "backend/alembic/versions/0080.py"]:
            self.assertEqual(POLICY.classify([path])["code"], "true")
            self.assertEqual(POLICY.classify([path], main=True)["parser"], "true")

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
        for job in ["backend-integration", "frontend", "frontend-unit", "integration", "migrations",
                    "assistant-parser", "supply-chain"]:
            needs[job] = {"result": "skipped"}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for result in ["failure", "cancelled", None]:
            needs["frontend"] = {"result": result}
            self.assertTrue(POLICY.gate_errors(policy, needs))

    def test_gate_rejects_failure_cancellation_or_missing_required_job(self):
        policy = POLICY.classify(None)
        jobs = ["changes", "repository", "security", "backend-integration", "frontend", "frontend-unit",
                "integration", "migrations", "assistant-parser", "supply-chain"]
        for job in jobs:
            for result in ["failure", "cancelled", "skipped", None]:
                needs = {name: {"result": "success"} for name in jobs}
                needs[job] = {"result": result}
                self.assertTrue(POLICY.gate_errors(policy, needs), (job, result))

    def test_invalid_policy_cannot_succeed(self):
        self.assertTrue(POLICY.gate_errors({}, {}))

    def test_new_job_cannot_fail_or_skip_silently(self):
        needs = {"future-check": {"result": "failure"}}
        self.assertIn("future-check: unplanned non-success result",
                      POLICY.gate_errors(POLICY.classify(None), needs))

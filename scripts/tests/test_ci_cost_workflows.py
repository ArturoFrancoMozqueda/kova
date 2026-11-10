"""Keep cost reductions separate from production safety and scheduled operations."""

import re
import unittest
from pathlib import Path

from test_ci_policy import POLICY


WORKFLOWS = Path(__file__).resolve().parents[2] / ".github/workflows"


def job(filename, name):
    source = (WORKFLOWS / filename).read_text().split("jobs:\n", 1)[1]
    sections = dict(re.findall(
        r"(?ms)^  ([a-z][a-z0-9-]*):\n(.*?)(?=^  [a-z][a-z0-9-]*:|\Z)", source))
    return sections[name]


class CiCostWorkflowTests(unittest.TestCase):
    def test_ci_only_does_not_publish_but_retains_all_required_validations(self):
        release = job("ci.yml", "release")
        self.assertIn("needs.changes.outputs.code == 'true'", release)
        self.assertIn("needs.changes.outputs.release == 'true'", release)
        self.assertIn("needs.required.result == 'success'", release)
        policy = POLICY.classify([".github/workflows/ci.yml"], main=True)
        self.assertEqual(policy["release"], "false")
        needs = {name: {"result": "success"} for name in (
            "changes", "repository", "security", "backend-integration", "backend-workers",
            "backend-native", "frontend-unit", "frontend", "integration", "migrations",
            "assistant-parser", "supply-chain")}
        self.assertEqual(POLICY.gate_errors(policy, needs), [])
        for name in needs:
            for result in ("failure", "cancelled", "skipped"):
                self.assertTrue(POLICY.gate_errors(policy, needs | {name: {"result": result}}),
                                (name, result))

    def test_docs_skip_dependency_tools_but_still_scan_secrets(self):
        security = job("ci.yml", "security")
        self.assertIn("needs: [changes]", security)
        steps = re.split(r"(?m)^      - ", security)[1:]
        for step in steps:
            if any(marker in step for marker in (
                "actions/setup-python@", "actions/setup-node@", "astral-sh/setup-uv@",
                "scripts/audit_dependencies.py", "name: Upload dependency advisory")):
                self.assertIn("needs.changes.outputs.code == 'true'", step)
        secret_scan = next(step for step in steps if "gitleaks/gitleaks-action@" in step)
        self.assertIn("if: success() || failure()", secret_scan)
        self.assertNotIn("needs.changes.outputs.code", secret_scan)

    def test_duplicate_audits_skip_only_in_the_caller_with_required_image_gates(self):
        caller = job("ci.yml", "supply-chain")
        self.assertIn("supply_chain_only: true", caller)
        self.assertIn("if: needs.changes.outputs.supply == 'true'", caller)
        policy = POLICY.classify([".github/workflows/ci.yml"])
        self.assertEqual((policy["backend"], policy["parser"], policy["supply"]),
                         ("true", "true", "true"))
        self.assertIn("audit_dependencies.py image --name native",
                      job("native-backend.yml", "acceptance"))
        self.assertIn("audit_dependencies.py image --name parser",
                      job("ci.yml", "assistant-parser"))
        source = (WORKFLOWS / "ci-maintenance.yml").read_text()
        self.assertRegex(source, r"supply_chain_only:\n(?:[^\n]*\n)*?        default: false")
        for name in ("dependency-advisories", "image-advisories"):
            self.assertIn("if: ${{ !inputs.supply_chain_only }}", job("ci-maintenance.yml", name))
        self.assertNotIn("if:", job("ci-maintenance.yml", "container-supply-chain"))
        self.assertIn('cron: "41 8 * * 1"', source)


if __name__ == "__main__":
    unittest.main()

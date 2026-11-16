"""Keep cost reductions separate from production safety and scheduled operations."""

import re
import os
import subprocess
import tempfile
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
    def test_whatsapp_gate_is_explicit_serialized_and_closes_on_failed_rollout(self):
        source = (WORKFLOWS / "ci.yml").read_text()
        self.assertIn("default: preserve", source)
        self.assertIn("options: [preserve, enable, disable]", source)
        release = job("ci.yml", "release")
        steps = re.split(r"(?m)^      - ", release)[1:]
        gate = next(step for step in steps if "id: whatsapp_signup" in step)
        self.assertIn("github.event_name == 'workflow_dispatch'", gate)
        self.assertIn("github.ref == 'refs/heads/main'", gate)
        self.assertIn("vars.KOVA_NATIVE_BACKEND == '1'", gate)
        self.assertIn("inputs.whatsapp_signup != 'preserve'", gate)
        self.assertIn("SIGNUP_ACTION: ${{ inputs.whatsapp_signup }}", gate)
        self.assertLess(release.index("Prepare independent native API publication"),
                        release.index("id: whatsapp_signup"))
        self.assertLess(release.index("id: whatsapp_signup"),
                        release.index("Release candidate, promote and recover by phase"))
        close = next(step for step in steps if "Close new WhatsApp signups" in step)
        self.assertIn("failure() && contains(fromJSON('[\"success\",\"failure\"]'), steps.whatsapp_signup.outcome)", close)
        self.assertIn("--text false", close)
        self.assertIn("--worker kova-native-signup-settings", close)

    def test_whatsapp_gate_commands_only_write_the_fixed_boolean_and_stop_on_error(self):
        release = job("ci.yml", "release")
        gate = next(step for step in re.split(r"(?m)^      - ", release)[1:]
                    if "id: whatsapp_signup" in step)
        script = "\n".join(line[10:] for line in gate.split("        run: |\n", 1)[1].splitlines())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "node_modules/.bin/cf"
            binary.parent.mkdir(parents=True)
            binary.write_text('#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALLS"\n'
                              'if [[ "$*" == *--dry-run* ]]; then exit "${DRY_EXIT:-0}"; fi\n'
                              'exit "${APPLY_EXIT:-0}"\n')
            binary.chmod(0o700)
            for action, expected, dry_exit, apply_exit in (
                ("enable", "true", "0", "0"), ("disable", "false", "0", "0"),
                ("preserve", None, "0", "0"), ("enable; touch unexpected", None, "0", "0"),
                ("enable", "true", "1", "0"), ("enable", "true", "0", "1"),
            ):
                with self.subTest(action=action, dry_exit=dry_exit, apply_exit=apply_exit):
                    calls = root / "calls"
                    calls.unlink(missing_ok=True)
                    result = subprocess.run(["bash", "-c", script], cwd=root, capture_output=True,
                        env={**os.environ, "SIGNUP_ACTION": action, "CALLS": str(calls),
                             "DRY_EXIT": dry_exit, "APPLY_EXIT": apply_exit})
                    commands = calls.read_text().splitlines() if calls.exists() else []
                    self.assertEqual(result.returncode == 0,
                                     expected is not None and dry_exit == apply_exit == "0")
                    self.assertEqual(len(commands), 0 if expected is None else 1 if dry_exit != "0" else 2)
                    for command in commands:
                        self.assertTrue(command.startswith("workers secrets update WHATSAPP_SIGNUP_ENABLED "))
                        self.assertIn("--worker kova-native-signup-settings --type secret_text", command)
                        self.assertIn(f"--text {expected}", command)
                    if commands:
                        self.assertIn("--dry-run", commands[0])
                    if len(commands) == 2:
                        self.assertNotIn("--dry-run", commands[1])
            self.assertFalse((root / "unexpected").exists())

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

"""Exercise maintenance refusal and exact-commit gates without secrets or network."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/product-thumbnail-maintenance.yml"
SHA = "a" * 40


def run_block(name):
    section = WORKFLOW.read_text().split(f"      - name: {name}\n", 1)[1]
    source = section.split("        run: |\n", 1)[1]
    lines = []
    for line in source.splitlines():
        if line and not line.startswith("          "):
            break
        lines.append(line[10:])
    return "\n".join(lines) + "\n"


def check(*, identifier=1, sha=SHA, status="completed", conclusion="success", app="github-actions"):
    return {"id": identifier, "name": "CI required", "head_sha": sha,
            "status": status, "conclusion": conclusion, "app": {"slug": app}}


class ThumbnailMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.environment = {
            "PATH": str(self.path) + os.pathsep + os.environ.get("PATH", ""),
            "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main",
            "GITHUB_REPOSITORY": "ArturoFrancoMozqueda/kova", "GITHUB_SHA": SHA,
            "PREPARE_EXISTING": "true", "RUNNER_TEMP": str(self.path),
        }
        (self.path / "python").symlink_to(sys.executable)
        gh = self.path / "gh"
        gh.write_text(
            f"#!{sys.executable}\n"
            "import os, pathlib, sys\n"
            "expected = ['api', '--method', 'GET', "
            "f'repos/ArturoFrancoMozqueda/kova/commits/{os.environ[\"GITHUB_SHA\"]}/check-runs?per_page=100']\n"
            "if sys.argv[1:] != expected: raise SystemExit(2)\n"
            "sys.stdout.write(pathlib.Path(os.environ['RUNNER_TEMP'], 'response.json').read_text())\n",
        )
        gh.chmod(0o700)

    def run_guard(self, **overrides):
        return subprocess.run(
            ["bash", "-c", run_block("Require explicit preparation on main")],
            env={**self.environment, **overrides}, capture_output=True, text=True, check=False,
        )

    def run_gate(self, checks, **overrides):
        (self.path / "response.json").write_text(json.dumps({"check_runs": checks}))
        return subprocess.run(
            ["bash", "-c", run_block("Require latest completed CI for the exact commit")],
            env={**self.environment, **overrides}, capture_output=True, text=True, check=False,
        )

    def test_guard_requires_manual_main_explicit_true_and_original_repository(self):
        self.assertEqual(self.run_guard().returncode, 0)
        for field, value in [
            ("PREPARE_EXISTING", "false"), ("PREPARE_EXISTING", ""),
            ("GITHUB_REF", "refs/heads/feature/test"), ("GITHUB_EVENT_NAME", "push"),
            ("GITHUB_REPOSITORY", "fork/kova"),
        ]:
            with self.subTest(field=field, value=value):
                self.assertNotEqual(self.run_guard(**{field: value}).returncode, 0)

    def test_gate_accepts_latest_completed_success_only_for_exact_sha_and_actions(self):
        self.assertEqual(self.run_gate([check()]).returncode, 0)
        self.assertEqual(self.run_gate([
            check(identifier=2), check(identifier=1, conclusion="failure"),
        ]).returncode, 0)
        for checks in [
            [], [check(sha="b" * 40)], [check(app="third-party-app")],
            [check(status="in_progress")], [check(conclusion="skipped")],
            [check(), check(identifier=2, conclusion="failure")],
            [check(), check(identifier=2, status="queued", conclusion=None)],
        ]:
            with self.subTest(checks=checks):
                self.assertNotEqual(self.run_gate(checks).returncode, 0)

    def test_optimized_python_cannot_disable_gate_or_weaken_exact_sha(self):
        self.assertNotEqual(self.run_gate([check(conclusion="failure")], PYTHONOPTIMIZE="1").returncode, 0)
        self.assertNotEqual(self.run_gate([check(sha="invalid")], GITHUB_SHA="invalid").returncode, 0)

    def test_dispatch_and_database_secret_are_confined_to_guarded_bounded_step(self):
        source = WORKFLOW.read_text()
        trigger = source.split("on:\n", 1)[1].split("permissions:\n", 1)[0]
        self.assertIn("workflow_dispatch:", trigger)
        self.assertIn("default: false", trigger)
        self.assertNotIn("schedule:", trigger)
        self.assertNotIn("push:", trigger)
        self.assertNotIn("pull_request:", trigger)
        self.assertIn("permissions:\n  contents: read\n  checks: read", source)
        self.assertIn("group: product-thumbnail-maintenance\n  cancel-in-progress: false", source)
        self.assertIn("needs: [guard]", source)
        self.assertIn("environment: production\n    timeout-minutes: 10", source)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.prepare_existing", source)
        preparation = source.split("      - name: Prepare bounded derived product thumbnails\n", 1)
        self.assertNotIn("SUPABASE_DB_URL", preparation[0])
        self.assertIn("APP_ENV: production", preparation[1])
        self.assertIn("SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}", preparation[1])
        self.assertIn('uv run --project backend --frozen python backend/scripts/prepare_product_thumbnails.py --prepare-existing --sha "$GITHUB_SHA" --limit 100', preparation[1])
        self.assertEqual(source.count("secrets."), 1)
        self.assertNotIn("provision_native_runtime", source)
        for action in [
            "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
            "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1",
            "astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e",
        ]:
            self.assertIn(action, source)


if __name__ == "__main__":
    unittest.main()

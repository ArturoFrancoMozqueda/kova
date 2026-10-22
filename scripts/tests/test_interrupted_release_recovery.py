"""Safety boundaries of the single-incident, manually authorized recovery."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/recover-interrupted-release.yml"


class InterruptedReleaseRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text()

    def test_only_approved_main_dispatch_can_recover(self):
        trigger = self.source.split("permissions:", 1)[0]
        self.assertIn("workflow_dispatch:", trigger)
        self.assertNotRegex(trigger, r"(?m)^  (push|pull_request|schedule|workflow_run):")
        self.assertIn("default: false", trigger)
        self.assertIn("if: github.ref == 'refs/heads/main' && inputs.approve_recovery", self.source)
        self.assertIn("environment: production", self.source)

    def test_recovery_shares_non_cancelling_release_queue(self):
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        name = re.search(r"^name: (.+)$", ci, re.M).group(1)
        self.assertIn("format('{0}-{1}', github.workflow, github.ref)", ci)
        self.assertIn(f"group: {name}-refs/heads/main", self.source)
        self.assertIn("cancel-in-progress: false", self.source)

    def test_exact_artifact_and_incident_are_required_before_mutation(self):
        download = self.source.index("gh run download 39709835800")
        checksum = self.source.index("sha256sum --check --strict")
        validate = self.source.index("validateRollbackArtifact(JSON.parse")
        state = self.source.index("Incident changed; inspect before retrying")
        restore = self.source.index("node frontend/scripts/release-recovery.mjs")
        self.assertLess(download, checksum)
        self.assertLess(checksum, validate)
        self.assertLess(validate, state)
        self.assertLess(state, restore)
        self.assertIn("release-rollback-443fa3fc84bf24b9bddb35c449c3fe1ec918b1ca", self.source)
        self.assertIn("assert.equal(response.status, 200)", self.source)
        self.assertIn("--phase candidate", self.source)
        self.assertIn("--failed-sha 443fa3fc84bf24b9bddb35c449c3fe1ec918b1ca", self.source)

    def test_dependencies_do_not_receive_production_secrets(self):
        install = self.source.split("- name: Install locked recovery tools", 1)[1].split("- name:", 1)[0]
        self.assertIn("npm ci --prefix deploy/cloudflare-backend", install)
        self.assertNotIn("secrets.", install)
        self.assertIn("persist-credentials: false", self.source)
        self.assertNotIn("SUPABASE_DB_URL", self.source)
        self.assertNotIn("DATABASE_URL", self.source)
        self.assertNotIn("alembic", self.source)
        self.assertNotIn("continue-on-error", self.source)


if __name__ == "__main__":
    unittest.main()

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "audit_dependencies", Path(__file__).resolve().parents[1] / "audit_dependencies.py"
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class DependencyAuditTests(unittest.TestCase):
    def test_actual_inventory_covers_all_tracked_locks_and_exact_parser_pins(self):
        self.assertEqual(AUDIT.inventory_errors(), [])
        pins = AUDIT.python_pins()
        self.assertEqual(set(pins), set(AUDIT.PYTHON_LOCKS) | {AUDIT.PARSER})
        self.assertGreater(len(pins["backend/uv.lock"]), 50)
        self.assertGreater(len(pins["deploy/cloudflare-backend/pylock.toml"]), 30)
        self.assertTrue(all(AUDIT.PIN.fullmatch(pin) for source in pins.values() for pin in source))
        self.assertFalse(any("pos-backend" in pin for source in pins.values() for pin in source))

    def test_unclassified_lock_or_deleted_known_lock_fails_closed(self):
        known = list(AUDIT.NPM_LOCKS + AUDIT.PYTHON_LOCKS)
        for files in [known + ["new-service/package-lock.json"], known[1:]]:
            with self.subTest(files=files), mock.patch.object(AUDIT.subprocess, "run") as run:
                run.return_value = subprocess.CompletedProcess([], 0, "\0".join(files).encode())
                self.assertTrue(AUDIT.inventory_errors())

    def test_parser_unpinned_install_cannot_disappear_from_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for source in AUDIT.PYTHON_LOCKS:
                path = root / source
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((AUDIT.ROOT / source).read_bytes())
            path = root / AUDIT.PARSER
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("RUN pip install --no-cache-dir pypdf>=6 defusedxml==0.7.1\n")
            with self.assertRaisesRegex(ValueError, "explicit name==version"):
                AUDIT.python_pins(root)

    def test_python_report_rejects_advisory_skip_missing_and_malformed_results(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "python.json"
            safe = {"name": "pypdf", "version": "6.21.2", "vulns": []}
            for result in [
                {"dependencies": []},
                {"dependencies": [safe | {"vulns": [{"id": "CVE-test", "fix_versions": []}]}]},
                {"dependencies": [safe | {"skip_reason": "not found"}]},
                {"error": "network failure"},
            ]:
                report.write_text(json.dumps(result))
                self.assertFalse(AUDIT.python_report_passed(report, ["pypdf==6.21.2"]))
            report.write_text("not json")
            self.assertFalse(AUDIT.python_report_passed(report, ["pypdf==6.21.2"]))
            report.write_text(json.dumps({"dependencies": [safe]}))
            self.assertTrue(AUDIT.python_report_passed(report, ["pypdf==6.21.2"]))
            self.assertFalse(AUDIT.python_report_passed(report, ["pypdf==6.21.1"]))

    def test_npm_high_dev_and_errors_fail_even_if_tool_reports_success(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "npm.json"
            for result in [
                {"metadata": {"vulnerabilities": {"high": 1, "critical": 0}}},
                {"metadata": {"vulnerabilities": {"high": 0, "critical": 1}}},
                {"error": {"code": "EAI_AGAIN"}}, {},
            ]:
                report.write_text(json.dumps(result))
                self.assertFalse(AUDIT.npm_report_passed(report))
            report.write_text(json.dumps({"metadata": {"vulnerabilities": {
                "high": 0, "critical": 0, "moderate": 1,
            }}}))
            self.assertTrue(AUDIT.npm_report_passed(report))

    def test_python_scans_remaining_sources_after_a_failure_without_installing_packages(self):
        calls = []

        def scan(command):
            calls.append(command)
            report = Path(command[command.index("--output") + 1])
            pins = Path(command[command.index("--requirement") + 1]).read_text().splitlines()
            dependencies = [{"name": pin.split("==")[0], "version": pin.split("==")[1],
                             "vulns": []} for pin in pins]
            report.write_text(json.dumps({"dependencies": dependencies}))
            return len(calls) != 1

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(AUDIT, "_run", scan):
            self.assertFalse(AUDIT.audit_python(Path(directory)))
        self.assertEqual(len(calls), 3)
        self.assertTrue(all("--no-deps" in call and "--disable-pip" in call for call in calls))

    def test_image_report_requires_both_os_and_language_scans_and_no_high_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "image.json"
            safe = {"SchemaVersion": 2, "ArtifactType": "container_image", "Results": [
                {"Class": "os-pkgs"}, {"Class": "lang-pkgs"},
            ]}
            for result in [
                {}, safe | {"Results": []}, safe | {"Results": [{"Class": "os-pkgs"}]},
                safe | {"Results": [{"Class": "os-pkgs"}, {"Class": "lang-pkgs",
                    "Vulnerabilities": [{"Severity": "HIGH", "FixedVersion": ""}]}]},
            ]:
                report.write_text(json.dumps(result))
                self.assertFalse(AUDIT.image_report_passed(report))
            report.write_text("not json")
            self.assertFalse(AUDIT.image_report_passed(report))
            report.write_text(json.dumps(safe))
            self.assertTrue(AUDIT.image_report_passed(report))

    def test_successful_scanner_without_report_still_fails(self):
        def successful_tool(command, **kwargs):
            if command[:2] == ["docker", "save"]:
                Path(command[command.index("--output") + 1]).write_bytes(b"synthetic tar")
            return True

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(AUDIT, "_run", successful_tool):
            self.assertFalse(AUDIT.audit_image("native", "synthetic:test", Path(directory)))

    def test_image_scanner_uses_saved_archive_and_blocks_unfixed_without_ignores(self):
        calls = []

        def scanner(command, **kwargs):
            calls.append(command)
            if command[:2] == ["docker", "save"]:
                Path(command[command.index("--output") + 1]).write_bytes(b"synthetic image tar")
                return True
            self.assertEqual(kwargs["stdin"].read(), b"synthetic image tar")
            kwargs["stdout"].write('{"error":"scanner failure"}')
            return False

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(AUDIT, "_run", scanner):
            self.assertFalse(AUDIT.audit_image("native", "synthetic:test", Path(directory)))
            save, scan = calls
        self.assertEqual(save[:2], ["docker", "save"])
        self.assertIn(AUDIT.TRIVY, scan)
        self.assertIn("--ignore-unfixed=false", scan[-1])
        self.assertIn("HIGH,CRITICAL", scan[-1])
        self.assertIn("--ignorefile /dev/null", scan[-1])
        self.assertIn("--exit-code 1", scan[-1])
        self.assertFalse(any("docker.sock" in arg or arg == "--env" for arg in scan))
        self.assertEqual(scan[scan.index("--volume") + 1], "kova-trivy-cache:/root/.cache/trivy")
        self.assertIn("--interactive", scan)


if __name__ == "__main__":
    unittest.main()

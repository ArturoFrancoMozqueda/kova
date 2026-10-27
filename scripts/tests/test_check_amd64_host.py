import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "check_amd64_host", Path(__file__).resolve().parents[1] / "check_amd64_host.py"
)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


def cpu_output(**changes):
    fields = {"Architecture:": "x86_64", "CPU(s):": "4",
              "Vendor ID:": "GenuineIntel", "Model name:": "Intel(R) Xeon(R) Platinum 8370C"}
    fields.update(changes)
    return json.dumps({"lscpu": [{"field": field, "data": data}
                                  for field, data in fields.items()]})


class Amd64HostTests(unittest.TestCase):
    def setUp(self):
        self.system = mock.patch.object(HOST.platform, "system", return_value="Linux")
        self.machine = mock.patch.object(HOST.platform, "machine", return_value="x86_64")
        self.system.start()
        self.machine.start()
        self.addCleanup(self.system.stop)
        self.addCleanup(self.machine.stop)

    def runner(self, *, cpu=None, daemon="linux/x86_64"):
        def run(command, **kwargs):
            self.assertTrue(kwargs["check"])
            self.assertTrue(kwargs["capture_output"])
            self.assertEqual(kwargs["timeout"], 20)
            self.assertEqual(kwargs["env"]["LC_ALL"], "C")
            self.assertNotIn("shell", kwargs)
            self.assertIn(command, [["lscpu", "--json"], HOST.DOCKER_INFO])
            return subprocess.CompletedProcess(command, 0,
                (cpu if cpu is not None else cpu_output())
                if command[0] == "lscpu" else daemon, "")
        return run

    def test_intel_and_amd_evidence_is_bounded_and_whitelisted(self):
        for vendor in ("GenuineIntel", "AuthenticAMD"):
            with self.subTest(vendor=vendor):
                result = HOST.check_host(run=self.runner(cpu=cpu_output(**{
                    "Vendor ID:": vendor, "Unrelated secret:": "never include me",
                })), environ={"CI": "true", "RUNNER_ARCH": "X64", "TOKEN": "never include me"})
                self.assertEqual(result["status"], "passed")
                self.assertEqual(result["host"]["cpu"]["vendor"], vendor)
                self.assertEqual(result["host"]["cpu"]["logical_cpus"], 4)
                self.assertNotIn("never include me", json.dumps(result))

    def test_both_docker_amd64_aliases_are_supported(self):
        for daemon in ("linux/amd64", "linux/x86_64"):
            self.assertEqual(HOST.check_host(run=self.runner(daemon=daemon), environ={})["status"], "passed")

    def test_hierarchical_util_linux_fields_are_verified_too(self):
        nested = json.loads(cpu_output())
        vendor = nested["lscpu"].pop(2)
        vendor["children"] = [nested["lscpu"].pop()]
        nested["lscpu"].append(vendor)
        result = HOST.check_host(run=self.runner(cpu=json.dumps(nested)), environ={})
        self.assertEqual(result["host"]["cpu"]["model"], "Intel(R) Xeon(R) Platinum 8370C")

    def test_arm_and_non_linux_hosts_fail_before_invoking_any_tool(self):
        for system, machine in (("Darwin", "x86_64"), ("Linux", "aarch64"), ("Linux", "AMD64")):
            with self.subTest(system=system, machine=machine), mock.patch.object(
                HOST.platform, "system", return_value=system
            ), mock.patch.object(HOST.platform, "machine", return_value=machine):
                run = mock.Mock()
                with self.assertRaises(HOST.HostError):
                    HOST.check_host(run=run, environ={})
                run.assert_not_called()

    def test_ci_missing_wrong_or_conflicting_runner_arch_fails_closed(self):
        for env in ({"CI": "true"}, {"GITHUB_ACTIONS": "true"},
                    {"CI": "1", "RUNNER_ARCH": "ARM64"},
                    {"CI": "true", "RUNNER_ARCH": "x64"}, {"RUNNER_ARCH": "ARM64"}):
            with self.subTest(env=env), self.assertRaises(HOST.HostError):
                HOST.check_host(run=self.runner(), environ=env)

    def test_missing_runner_arch_is_valid_only_outside_ci(self):
        result = HOST.check_host(run=self.runner(), environ={"CI": "false", "GITHUB_ACTIONS": "false"})
        self.assertFalse(result["ci"])
        self.assertIsNone(result["runner_architecture"])

    def test_arm_foreign_os_or_malformed_daemon_rejects_emulated_container_runs(self):
        for daemon in ("linux/aarch64", "linux/arm64", "windows/amd64", "amd64", "linux/amd64\nlinux/arm64"):
            with self.subTest(daemon=daemon), self.assertRaises(HOST.HostError):
                HOST.check_host(run=self.runner(daemon=daemon), environ={})

    def test_cpu_arch_vendor_model_and_counts_must_prove_valid_native_execution(self):
        for change in ({"Architecture:": "aarch64"}, {"Vendor ID:": "Apple"},
                       {"Vendor ID:": ""}, {"Model name:": "QEMU Virtual CPU"},
                       {"Model name:": "TCG CPU"}, {"Model name:": "Rosetta x86_64"},
                       {"Model name:": ""}, {"Model name:": "x" * 161},
                       {"Model name:": "bad\nmodel"}, {"CPU(s):": "0"},
                       {"CPU(s):": "unknown"}):
            with self.subTest(change=change), self.assertRaises(HOST.HostError):
                HOST.check_host(run=self.runner(cpu=cpu_output(**change)), environ={})

    def test_malformed_incomplete_duplicate_and_oversized_lscpu_evidence_fails(self):
        duplicate = json.loads(cpu_output())
        duplicate["lscpu"].append({"field": "Vendor ID:", "data": "AuthenticAMD"})
        for output in ("invalid", "[]", "{}", '{"lscpu":{}}', '{"lscpu":[null]}',
                       '{"lscpu":[{"field":"CPU(s):","data":"4"}]}',
                       json.dumps(duplicate), "x" * (HOST.MAX_OUTPUT_BYTES + 1)):
            with self.subTest(output=output[:40]), self.assertRaises(HOST.HostError):
                HOST.check_host(run=self.runner(cpu=output), environ={})

    def test_tool_failure_and_timeout_do_not_expose_captured_payloads(self):
        for error in (FileNotFoundError("secret payload"),
                      subprocess.TimeoutExpired("secret command", 20, output="secret payload"),
                      subprocess.CalledProcessError(1, "secret command", stderr="secret payload")):
            with self.subTest(kind=type(error)), self.assertRaises(HOST.HostError) as caught:
                HOST.check_host(run=mock.Mock(side_effect=error), environ={})
            self.assertNotIn("secret", str(caught.exception))

    def test_cli_creates_report_parent_and_returns_verified_success(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            HOST, "check_host", return_value={"schema": 1, "status": "passed"}
        ), redirect_stdout(io.StringIO()):
            path = Path(directory) / "nested" / "host.json"
            self.assertEqual(HOST.main(["--report", str(path)]), 0)
            self.assertEqual(json.loads(path.read_text())["status"], "passed")

    def test_cli_always_records_safe_failure_without_exception_payload(self):
        for error in (HOST.HostError("CI must identify its runner architecture as X64"),
                      RuntimeError("secret token in unexpected tool payload")):
            with self.subTest(kind=type(error)), tempfile.TemporaryDirectory() as directory, mock.patch.object(
                HOST, "check_host", side_effect=error
            ), redirect_stdout(io.StringIO()) as output:
                path = Path(directory) / "failure" / "host.json"
                self.assertEqual(HOST.main(["--report", str(path)]), 1)
                report = path.read_text()
                self.assertEqual(json.loads(report)["status"], "failed")
                self.assertNotIn("secret", report + output.getvalue())


if __name__ == "__main__":
    unittest.main()

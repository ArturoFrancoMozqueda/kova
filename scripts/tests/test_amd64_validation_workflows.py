"""Keep native acceptance failures and immutable build identity visible in CI."""

import os
import re
import shlex
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"


def workflow_step(filename, command):
    # Only read individual six-space workflow steps; no YAML dependency is
    # needed by the repository's stdlib-only contract test runner.
    source = (WORKFLOWS / filename).read_text()
    steps = re.split(r"(?m)^      - (?=name:|uses:|run:|id:)", source)[1:]
    matches = [step for step in steps if command in step]
    if len(matches) != 1:
        raise AssertionError(f"Expected one {command} step in {filename}")
    return matches[0]


def run_command(step):
    match = re.search(r"(?m)^        run: (.*)$", step)
    if match is None:
        raise AssertionError("Expected a workflow run command")
    if match[1] != "|":
        return match[1]
    lines = []
    for line in step[match.end():].splitlines()[1:]:
        if line and not line.startswith("          "):
            break
        lines.append(line)
    return textwrap.dedent("\n".join(lines))


class Amd64ValidationWorkflowTests(unittest.TestCase):
    def test_resource_pipeline_failure_stops_the_configured_shell(self):
        step = workflow_step("native-backend.yml", "--name kova-native-acceptance")
        command = run_command(step)
        self.assertIn("| tee", command)
        shell = re.search(r"(?m)^        shell: (.+)$", step)
        # GitHub's explicit bash shell enables -eo pipefail; its unspecified
        # Linux default uses bash -e and would hide the failed left pipeline.
        flags = ["--noprofile", "--norc", "-e", "-o", "pipefail"] if (
            shell is not None and shell[1] == "bash"
        ) else ["-e"]
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["bash", *flags, "-c",
                 'false | tee "$PROBE_OUT/pipeline.log"\n'
                 'printf continued > "$PROBE_OUT/continued"'],
                env={"PATH": os.defpath, "PROBE_OUT": directory},
                capture_output=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0,
                                "A failed acceptance check must fail the workflow step")
            self.assertFalse((Path(directory) / "continued").exists())

    def test_maintenance_build_passes_actual_commit_to_docker(self):
        step = workflow_step("ci-maintenance.yml", "Build exact runtime without deployment")
        matrix = {"dockerfile": "backend/Dockerfile.api", "name": "native", "context": "backend"}
        command = re.sub(r"\$\{\{\s*matrix\.(\w+)\s*\}\}",
                         lambda match: matrix[match[1]], run_command(step))
        sha = "1234567890abcdef" * 2 + "12345678"
        with tempfile.TemporaryDirectory() as directory:
            capture = Path(directory) / "arguments"
            docker = Path(directory) / "docker"
            docker.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n')
            docker.chmod(0o700)
            subprocess.run(
                ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", command],
                env={"PATH": directory + os.pathsep + os.defpath,
                     "GITHUB_SHA": sha, "CAPTURE": str(capture)},
                check=True, capture_output=True, timeout=10,
            )
            arguments = capture.read_text().splitlines()
        self.assertEqual(arguments[0], "build")
        self.assertIn("KOVA_RELEASE_SHA=" + sha,
                      [arguments[index + 1] for index, arg in enumerate(arguments)
                       if arg == "--build-arg"])

    def test_parser_gate_requires_native_architecture_and_keeps_report_in_both_workflows(self):
        for filename in ("ci.yml", "ci-maintenance.yml"):
            with self.subTest(workflow=filename):
                step = workflow_step(filename, "python backend/scripts/check_parser_runtime.py")
                arguments = shlex.split(run_command(step))
                self.assertEqual(arguments[arguments.index("--require-native-arch") + 1], "x86_64")
                self.assertEqual(arguments[arguments.index("--report") + 1],
                                 "reports/security/parser-runtime.json")

    def test_native_host_guard_and_failure_artifacts_survive_acceptance_failure(self):
        for filename in ("native-backend.yml", "ci-maintenance.yml"):
            with self.subTest(workflow=filename):
                step = workflow_step(filename, "python scripts/check_amd64_host.py")
                arguments = shlex.split(run_command(step))
                self.assertEqual(arguments[arguments.index("--report") + 1],
                                 "reports/security/native-host.json")
                source = (WORKFLOWS / filename).read_text()
                self.assertLess(source.index("python scripts/check_amd64_host.py"),
                                source.index("- name: Build exact runtime") if filename ==
                                "ci-maintenance.yml" else source.index("--name kova-native-acceptance"))
        step = workflow_step("native-backend.yml", "--name kova-native-acceptance")
        arguments = shlex.split(run_command(step))
        for flag in ("--read-only", "--cap-drop", "--security-opt", "--pids-limit"):
            self.assertIn(flag, arguments)
        for option, value in (("--memory", "256m"), ("--memory-swap", "256m"),
                              ("--cpus", "0.0625"), ("--cap-drop", "ALL"),
                              ("--security-opt", "no-new-privileges"), ("--pids-limit", "64")):
            self.assertEqual(arguments[arguments.index(option) + 1], value)
        cleanup = workflow_step("native-backend.yml", "docker logs --tail 20 kova-native-acceptance")
        self.assertRegex(cleanup, r"(?m)^        if: always\(\)$")
        for report in ("native-container.log", "native-container.json"):
            self.assertIn("reports/security/" + report, cleanup)
        upload = workflow_step("native-backend.yml", "name: security-native-")
        self.assertRegex(upload, r"(?m)^        if: always\(\)$")
        self.assertRegex(upload, r"(?m)^          path: reports/security$")
        source = (WORKFLOWS / "native-backend.yml").read_text()
        self.assertLess(source.index("--name kova-native-acceptance"), source.index(cleanup))
        self.assertLess(source.index(cleanup), source.index(upload))


if __name__ == "__main__":
    unittest.main()

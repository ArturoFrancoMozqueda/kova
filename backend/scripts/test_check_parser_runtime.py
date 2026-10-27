import copy
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError

SPEC = importlib.util.spec_from_file_location(
    "check_parser_runtime",
    Path(__file__).with_name("check_parser_runtime.py"),
)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


def valid_report(expected):
    library_hash, binary_hash = "1" * 64, "2" * 64
    manifest = copy.deepcopy(expected["manifest"])
    return {
        "uid": 65534,
        "architecture": "x86_64",
        "libxml2": {
            "provenance": {
                "name": "libxml2",
                "version": "2.13.9-r2",
                "source_sha256": "a2c9ae7b770da34860050c309f903221c67830c86e4a7e760692b803df95143a",
                "library_sha256": library_hash,
                "patches": copy.deepcopy(expected["patches"]),
            },
            "library": {"path": "/usr/lib/libxml2.so.2.13.9", "sha256": library_hash},
            "runtime_version": "21309",
            "patch_files": copy.deepcopy(expected["patch_files"]),
            "test_files": copy.deepcopy(expected["test_files"]),
            "backports": {
                "regressions": 6,
                "passed": sorted(GATE.EXPECTED_CVES),
                "failures": 0,
                "skipped": 0,
            },
            "upstream": {"tests": 6, "failures": 0, "errors": 0, "skipped": 0},
        },
        "ocr": {
            "manifest": manifest,
            "version": "tesseract " + manifest["source"]["version"],
            "build": {
                "source": {
                    "commit": manifest["source"]["commit"],
                    "sha256": manifest["source"]["sha256"],
                    "files": copy.deepcopy(expected["source_files"]),
                },
                "binary": {"path": "/usr/local/bin/tesseract", "sha256": binary_hash},
                "model": {
                    "path": "/usr/local/share/tessdata/spa.traineddata",
                    "sha256": manifest["model"]["sha256"],
                },
            },
            "binary_sha256": binary_hash,
            "model_sha256": manifest["model"]["sha256"],
            "summary": {
                "architecture": "x86_64",
                "suites": 17,
                "tests": 17,
                "failures": 0,
                "errors": 0,
                "skipped": 0,
                "skipped_cases": [],
            },
            "suites": {
                name: {"tests": 1, "failures": 0, "errors": 0, "skipped": 0}
                for name in GATE.EXPECTED_SUITES
            },
        },
    }


class Response(io.BytesIO):
    def __init__(self, body, *, status=200, link=None):
        super().__init__(body if isinstance(body, bytes) else json.dumps(body).encode())
        self.status = status
        self.headers = {"Link": link} if link else {}


class RuntimeGateTests(unittest.TestCase):
    def setUp(self):
        self.expected = GATE.load_expected()

    def test_real_manifest_has_complete_reviewed_patch_and_source_inventory(self):
        self.assertEqual(len(self.expected["patches"]), 6)
        self.assertGreaterEqual(len(self.expected["manifest"]["advisories"]), 19)
        self.assertTrue(self.expected["source_files"])
        GATE.validate_report(valid_report(self.expected), self.expected)

    def test_arm_candidate_is_verified_as_built_not_relabelled_or_forced_to_amd64(self):
        report = valid_report(self.expected)
        report["architecture"] = "aarch64"
        report["ocr"]["summary"]["architecture"] = "aarch64"
        GATE.validate_report(report, self.expected)
        report["ocr"]["summary"]["architecture"] = "x86_64"
        with self.assertRaisesRegex(GATE.GateError, "summary"):
            GATE.validate_report(report, self.expected)

    def test_actual_library_hash_and_real_version_are_required_not_relabeling(self):
        for field, value in [("runtime_version", "21400"), ("runtime_version", "21309-fixed")]:
            report = valid_report(self.expected)
            report["libxml2"][field] = value
            with self.assertRaisesRegex(GATE.GateError, "Actual libxml2"):
                GATE.validate_report(report, self.expected)
        report = valid_report(self.expected)
        report["libxml2"]["library"]["sha256"] = "a" * 64
        with self.assertRaisesRegex(GATE.GateError, "Actual libxml2"):
            GATE.validate_report(report, self.expected)

    def test_missing_patch_hash_or_unexecuted_case_blocks_image(self):
        for key in ("patch_files", "test_files"):
            report = valid_report(self.expected)
            report["libxml2"][key].pop(next(iter(report["libxml2"][key])))
            with self.assertRaisesRegex(GATE.GateError, "patch/test hashes"):
                GATE.validate_report(report, self.expected)
        report = valid_report(self.expected)
        report["libxml2"]["backports"]["passed"].pop()
        with self.assertRaisesRegex(GATE.GateError, "PASS regression"):
            GATE.validate_report(report, self.expected)

    def test_ocr_commit_source_binary_and_model_must_match_actual_bytes(self):
        for problem in ("commit", "source_file", "binary", "model", "fake_version"):
            with self.subTest(problem=problem):
                report = valid_report(self.expected)
                ocr = report["ocr"]
                if problem == "commit":
                    ocr["build"]["source"]["commit"] = "a" * 40
                elif problem == "source_file":
                    ocr["build"]["source"]["files"].pop(next(iter(self.expected["source_files"])))
                elif problem == "binary":
                    ocr["binary_sha256"] = "a" * 64
                elif problem == "model":
                    ocr["model_sha256"] = "a" * 64
                else:
                    ocr["version"] = "tesseract 5.5.4"
                with self.assertRaises(GATE.GateError):
                    GATE.validate_report(report, self.expected)

    def test_17_suites_must_have_executed_cases_and_consistent_summary(self):
        for problem in ("missing_suite", "zero_cases", "failure", "mismatched_summary"):
            report = valid_report(self.expected)
            if problem == "missing_suite":
                report["ocr"]["suites"].pop("intproto_test")
            elif problem == "zero_cases":
                report["ocr"]["suites"]["intproto_test"]["tests"] = 0
            elif problem == "failure":
                report["ocr"]["suites"]["intproto_test"]["failures"] = 1
            else:
                report["ocr"]["summary"]["tests"] = 999
            with self.assertRaises(GATE.GateError):
                GATE.validate_report(report, self.expected)

    def test_only_explicit_upstream_simd_skip_is_accepted_never_counted_as_pass(self):
        report = valid_report(self.expected)
        report["ocr"]["summary"]["skipped"] = 1
        report["ocr"]["summary"]["skipped_cases"] = [
            {
                "suite": "weightmatrix_intdim_test",
                "case": "architecture",
                "reason": "no SIMD int backend active",
            }
        ]
        report["ocr"]["suites"]["weightmatrix_intdim_test"]["skipped"] = 1
        GATE.validate_report(report, self.expected)
        report["ocr"]["summary"]["skipped_cases"][0]["reason"] = "security test disabled"
        with self.assertRaisesRegex(GATE.GateError, "Unexpected skipped"):
            GATE.validate_report(report, self.expected)

    def test_docker_uses_immutable_candidate_without_network_privileges_or_writable_root(self):
        image_id = "sha256:" + "f" * 64
        run = mock.Mock(
            side_effect=[
                subprocess.CompletedProcess([], 0, stdout=image_id + "\n"),
                subprocess.CompletedProcess([], 0, stdout=json.dumps(valid_report(self.expected))),
            ]
        )
        result = GATE.check_image("parser:candidate", run=run)
        self.assertEqual(result["image_id"], image_id)
        args = run.call_args_list[1].args[0]
        for flag in (
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--memory=256m",
            "--cpus=1",
            "--pids-limit=64",
            "--pull=never",
        ):
            self.assertIn(flag, args)
        self.assertIn(image_id, args)
        self.assertNotIn("parser:candidate", args)
        self.assertNotIn("--env", args)
        self.assertNotIn("--privileged", args)
        self.assertNotIn("--platform", args)
        self.assertEqual(run.call_args_list[1].kwargs["timeout"], 90)

    def test_docker_failure_or_invalid_report_cannot_be_a_pass(self):
        image_id = "sha256:" + "f" * 64
        for output in ("not json", "{}", "[]", "null"):
            run = mock.Mock(
                side_effect=[
                    subprocess.CompletedProcess([], 0, stdout=image_id),
                    subprocess.CompletedProcess([], 0, stdout=output),
                ]
            )
            with self.assertRaises(GATE.GateError):
                GATE.check_image("parser:candidate", run=run)
        run = mock.Mock(side_effect=subprocess.TimeoutExpired("docker", 90))
        with self.assertRaisesRegex(GATE.GateError, "verification failed"):
            GATE.check_image("parser:candidate", run=run)

    def native_run(self, *, daemon="x86_64", image_platform="linux/amd64", report=None):
        return mock.Mock(side_effect=[
            subprocess.CompletedProcess([], 0, stdout="sha256:" + "f" * 64),
            subprocess.CompletedProcess([], 0, stdout=daemon),
            subprocess.CompletedProcess([], 0, stdout=image_platform),
            subprocess.CompletedProcess([], 0,
                                        stdout=json.dumps(report or valid_report(self.expected))),
        ])

    @mock.patch.object(GATE.platform, "system", return_value="Linux")
    @mock.patch.object(GATE.platform, "machine", return_value="x86_64")
    def test_native_amd64_records_host_daemon_immutable_image_and_runtime(self, *_):
        run = self.native_run(daemon="amd64")
        result = GATE.check_image("parser:candidate", run=run, require_native_arch="x86_64")
        self.assertEqual(result["native_execution"], {
            "required_architecture": "x86_64", "host_os": "Linux",
            "host_architecture": "x86_64", "docker_server_architecture": "amd64",
            "image_platform": "linux/amd64",
        })
        image_inspection = run.call_args_list[2].args[0]
        self.assertEqual(image_inspection[-1], result["image_id"])
        self.assertNotIn("--platform", run.call_args_list[3].args[0])

    def test_native_requirement_rejects_arm_host_before_docker_can_emulate_x86(self):
        for host_os, host_arch in (("Linux", "aarch64"), ("Darwin", "x86_64")):
            with self.subTest(host_os=host_os, host_arch=host_arch), \
                 mock.patch.object(GATE.platform, "system", return_value=host_os), \
                 mock.patch.object(GATE.platform, "machine", return_value=host_arch):
                run = self.native_run()
                with self.assertRaisesRegex(GATE.GateError, "Linux host architecture"):
                    GATE.check_image("parser:candidate", run=run, require_native_arch="x86_64")
                self.assertEqual(run.call_count, 1)

    @mock.patch.object(GATE.platform, "system", return_value="Linux")
    @mock.patch.object(GATE.platform, "machine", return_value="x86_64")
    def test_native_requirement_rejects_remote_arm_daemon_or_mislabeled_image(self, *_):
        for daemon, image_platform in (("aarch64", "linux/amd64"),
                                       ("x86_64", "linux/arm64"),
                                       ("x86_64", "windows/amd64")):
            with self.subTest(daemon=daemon, image_platform=image_platform):
                run = self.native_run(daemon=daemon, image_platform=image_platform)
                with self.assertRaisesRegex(GATE.GateError, "must match the native host"):
                    GATE.check_image("parser:candidate", run=run, require_native_arch="x86_64")
                self.assertEqual(run.call_count, 3)

    @mock.patch.object(GATE.platform, "system", return_value="Linux")
    @mock.patch.object(GATE.platform, "machine", return_value="x86_64")
    def test_native_requirement_also_rejects_emulated_arm_runtime_and_build(self, *_):
        report = valid_report(self.expected)
        report["architecture"] = report["ocr"]["summary"]["architecture"] = "aarch64"
        with self.assertRaisesRegex(GATE.GateError, "differs from the required native host"):
            GATE.check_image("parser:candidate", run=self.native_run(report=report),
                             require_native_arch="x86_64")

    @mock.patch.object(GATE.platform, "system", return_value="Linux")
    @mock.patch.object(GATE.platform, "machine", return_value="x86_64")
    def test_native_host_inspection_failure_cannot_be_a_pass(self, *_):
        run = mock.Mock(side_effect=[
            subprocess.CompletedProcess([], 0, stdout="sha256:" + "f" * 64),
            subprocess.TimeoutExpired("docker info", 30),
        ])
        with self.assertRaisesRegex(GATE.GateError, "verification failed"):
            GATE.check_image("parser:candidate", run=run, require_native_arch="x86_64")

    def test_image_options_cannot_be_injected(self):
        run = mock.Mock()
        with self.assertRaises(GATE.GateError):
            GATE.check_image("--privileged", run=run)
        run.assert_not_called()

    def test_cli_creates_nested_success_and_safe_failure_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nested/evidence/parser.json"
            arguments = [
                "check_parser_runtime.py",
                "--image",
                "parser:candidate",
                "--report",
                str(output),
            ]
            with (
                mock.patch.object(GATE.sys, "argv", arguments),
                mock.patch.object(
                    GATE,
                    "check_upstream_advisories",
                    return_value=["GHSA-0000-1111-2222"],
                ),
                mock.patch.object(
                    GATE,
                    "check_image",
                    return_value={
                        "image_id": "sha256:" + "f" * 64,
                        **valid_report(self.expected),
                    },
                ),
                mock.patch("sys.stdout", new_callable=io.StringIO),
            ):
                self.assertEqual(GATE.main(), 0)
            self.assertEqual(json.loads(output.read_text())["status"], "passed")
            with (
                mock.patch.object(GATE.sys, "argv", arguments),
                mock.patch.object(
                    GATE,
                    "check_upstream_advisories",
                    side_effect=GATE.GateError("Public feed unavailable"),
                ),
                mock.patch("sys.stderr", new_callable=io.StringIO),
            ):
                self.assertEqual(GATE.main(), 1)
            self.assertEqual(
                json.loads(output.read_text()),
                {
                    "status": "failed",
                    "error": "Public feed unavailable",
                },
            )
            with (
                mock.patch.object(GATE.sys, "argv", arguments),
                mock.patch.object(
                    GATE,
                    "load_expected",
                    side_effect=OSError("must-not-leak-private-path-or-payload"),
                ),
                mock.patch("sys.stderr", new_callable=io.StringIO) as errors,
            ):
                self.assertEqual(GATE.main(), 1)
            self.assertNotIn("must-not-leak", errors.getvalue())
            self.assertNotIn("must-not-leak", output.read_text())

    def test_cli_forwards_required_native_architecture(self):
        arguments = ["check_parser_runtime.py", "--image", "parser:candidate",
                     "--require-native-arch", "x86_64"]
        with mock.patch.object(GATE.sys, "argv", arguments), \
             mock.patch.object(GATE, "check_upstream_advisories", return_value=[]), \
             mock.patch.object(GATE, "check_image", return_value={
                 "image_id": "sha256:" + "f" * 64, **valid_report(self.expected),
             }) as check, mock.patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(GATE.main(), 0)
        check.assert_called_once_with("parser:candidate", require_native_arch="x86_64")


class AdvisoryFeedTests(unittest.TestCase):
    def setUp(self):
        self.expected = GATE.load_expected()
        self.rows = [
            {"ghsa_id": row["ghsa_id"], "severity": row["severity"]}
            for row in self.expected["manifest"]["advisories"]
        ]

    def test_public_feed_uses_no_credentials_and_covers_all_reviewed_severities(self):
        opener = mock.Mock(return_value=Response(self.rows))
        result = GATE.check_upstream_advisories(self.expected, open_url=opener)
        self.assertEqual(len(result), 19)
        request = opener.call_args.args[0]
        self.assertNotIn("Authorization", dict(request.header_items()))
        self.assertNotIn("Cookie", dict(request.header_items()))
        self.assertIn(
            "api.github.com/repos/tesseract-ocr/tesseract/security-advisories", request.full_url
        )
        self.assertEqual(opener.call_args.kwargs["timeout"], 20)

    def test_new_advisory_blocks_even_when_low_or_unknown_severity(self):
        for severity in ("low", "medium", "high", "critical", None):
            rows = self.rows + [{"ghsa_id": "GHSA-0000-1111-2222", "severity": severity}]
            with self.assertRaisesRegex(GATE.GateError, "Unreviewed upstream"):
                GATE.check_upstream_advisories(
                    self.expected, open_url=lambda *_a, rows=rows, **_k: Response(rows)
                )

    def test_pages_follow_verified_same_repo_cursor_until_short_page(self):
        rows = [{"ghsa_id": f"GHSA-{index:04x}-1111-2222"} for index in range(102)]
        expected = {"manifest": {"advisories": rows}}
        next_url = GATE.ADVISORY_URL + "?per_page=100&after=cursor&state=published"
        opener = mock.Mock(
            side_effect=[
                Response(rows[:100], link=f'<{next_url}>; rel="next"'),
                Response(rows[100:]),
            ]
        )
        result = GATE.check_upstream_advisories(expected, open_url=opener)
        self.assertEqual(len(result), 102)
        self.assertEqual(opener.call_args_list[1].args[0].full_url, next_url)

    def test_full_page_requires_continuation_and_repeated_cursor_fails_closed(self):
        rows = [{"ghsa_id": f"GHSA-{index:04x}-1111-2222"} for index in range(100)]
        expected = {"manifest": {"advisories": rows}}
        with self.assertRaisesRegex(GATE.GateError, "no verifiable continuation"):
            GATE.check_upstream_advisories(expected, open_url=lambda *_a, **_k: Response(rows))
        original = GATE.ADVISORY_URL + "?per_page=100&state=published"
        with self.assertRaisesRegex(GATE.GateError, "Repeated advisory"):
            GATE.check_upstream_advisories(
                expected,
                open_url=lambda *_a, **_k: Response(rows, link=f'<{original}>; rel="next"'),
            )

    def test_missing_known_feed_invalid_json_http_and_timeout_fail_closed(self):
        for body in ([], {"message": "rate limited"}, b"not JSON", self.rows[:-1]):
            with self.assertRaises(GATE.GateError):
                GATE.check_upstream_advisories(
                    self.expected, open_url=lambda *_a, body=body, **_k: Response(body)
                )
        for error in (
            HTTPError(GATE.ADVISORY_URL, 403, "rate limited", {}, None),
            URLError("unreachable"),
            TimeoutError("slow"),
        ):
            with self.assertRaisesRegex(GATE.GateError, "lookup failed"):
                GATE.check_upstream_advisories(self.expected, open_url=mock.Mock(side_effect=error))

    def test_host_cannot_follow_advisory_links_outside_exact_public_endpoint(self):
        for url in (
            "https://evil.invalid/?per_page=100",
            "http://api.github.com/?per_page=100",
            GATE.ADVISORY_URL + "?per_page=10&after=cursor",
            "https://api.github.com/repos/other/repo/security-advisories?per_page=100",
        ):
            with self.assertRaisesRegex(GATE.GateError, "Unsafe advisory"):
                GATE._next_page(f'<{url}>; rel="next"')


if __name__ == "__main__":
    unittest.main()

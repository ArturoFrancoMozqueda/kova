import tempfile
import unittest
from pathlib import Path

from verify_upstream_tests import EXPECTED_SUITES, verify


class UpstreamRegressionGateTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        for name in EXPECTED_SUITES:
            self.report(name)

    def report(self, name, *, failures=0, skipped=0, reason=""):
        skip = f'<skipped message="{reason}"/>' if skipped else ""
        (self.directory / f"{name}.xml").write_text(
            f'<testsuites tests="1" failures="{failures}" errors="0" skipped="{skipped}">'
            f'<testsuite><testcase name="security-regression">{skip}</testcase></testsuite>'
            '</testsuites>'
        )

    def test_accepts_complete_passing_security_reports(self):
        summary = verify(self.directory)
        self.assertEqual(summary["suites"], 17)
        self.assertEqual(summary["tests"], 17)
        self.assertEqual(summary["skipped"], 0)

    def test_fails_closed_on_missing_suite(self):
        (self.directory / "lstm_nullchar_test.xml").unlink()
        with self.assertRaises(FileNotFoundError):
            verify(self.directory)

    def test_rejects_failing_security_regression(self):
        self.report("intproto_test", failures=1)
        with self.assertRaisesRegex(ValueError, "did not pass"):
            verify(self.directory)

    def test_rejects_skipped_model_security_regressions(self):
        self.report("lstm_nullchar_test", skipped=1, reason="eng model missing")
        with self.assertRaisesRegex(ValueError, "was skipped"):
            verify(self.directory)

    def test_rejects_unexpected_skipped_noncritical_regression(self):
        self.report("weightmatrix_scales_test", skipped=1, reason="fixture missing")
        with self.assertRaisesRegex(ValueError, "Unexpected skipped"):
            verify(self.directory)

    def test_records_unreachable_architecture_branch_as_skipped(self):
        self.report("weightmatrix_intdim_test", skipped=1,
                    reason="no SIMD int backend active; the vulnerable path is unreachable")
        summary = verify(self.directory)
        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(len(summary["skipped_cases"]), 1)

    def test_counts_skipped_cases_without_aggregate_attribute(self):
        self.report("weightmatrix_intdim_test", skipped=1,
                    reason="no SIMD int backend active; the vulnerable path is unreachable")
        report = self.directory / "weightmatrix_intdim_test.xml"
        report.write_text(report.read_text().replace(' skipped="1"', ""))
        self.assertEqual(verify(self.directory)["skipped"], 1)


if __name__ == "__main__":
    unittest.main()

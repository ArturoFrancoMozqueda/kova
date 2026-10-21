import importlib.util
import io
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import MagicMock, patch


spec = importlib.util.spec_from_file_location(
    "native_resident", Path(__file__).resolve().parents[1] / "check_native_resident.py"
)
resident = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resident)


class ResidentAcceptanceTests(unittest.TestCase):
    def test_timeout_diagnostic_is_fixed_and_keeps_single_fifteen_second_attempt(self):
        with patch.object(resident.urllib.request, "urlopen", side_effect=TimeoutError("private failure")) as fetch, \
                patch.object(resident.time, "monotonic", side_effect=[100, 115]):
            with self.assertRaises(RuntimeError) as error:
                resident.observe("https://example.invalid", "/api/v1/reports/dashboard", 401)
        self.assertEqual(str(error.exception),
                         "Resident transport failed: endpoint=reports_dashboard method=GET elapsed_ms=15000 category=timeout")
        self.assertTrue(error.exception.__suppress_context__)
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.kwargs["timeout"], 15)
        request = fetch.call_args.args[0]
        self.assertEqual(request.get_header("X-kova-resident-diagnostic"), "1")
        self.assertEqual(request.get_header("Cookie"),
                         "access_token=synthetic-invalid-resident-probe")
        self.assertIsNone(request.data)

    def test_url_transport_and_unknown_path_cannot_disclose_request_or_failure(self):
        for path, method in [("/private?token=sensitive", "GET"), ("/health", "PATCH")]:
            with self.subTest(method=method), \
                    patch.object(resident.urllib.request, "urlopen", side_effect=urllib.error.URLError("sensitive reason")), \
                    patch.object(resident.time, "monotonic", side_effect=[10, 10.125]):
                with self.assertRaises(RuntimeError) as error:
                    resident.observe("https://example.invalid", path, 200, method=method)
            self.assertEqual(str(error.exception),
                             f"Resident transport failed: endpoint=unknown method={method if method == 'GET' else 'UNKNOWN'} elapsed_ms=125 category=url_transport")
            self.assertTrue(error.exception.__suppress_context__)

    def test_wrapped_timeout_is_identified_without_exposing_its_reason(self):
        with patch.object(resident.urllib.request, "urlopen", side_effect=urllib.error.URLError(TimeoutError("sensitive"))), \
                patch.object(resident.time, "monotonic", side_effect=[10, 11]):
            with self.assertRaisesRegex(RuntimeError, "endpoint=health_db method=GET elapsed_ms=1000 category=timeout"):
                resident.observe("https://example.invalid", "/api/health/db", 200)

    def test_timeout_reading_response_body_has_same_safe_diagnostic(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.headers = {"X-Kova-Runtime": "native-resident",
                            "X-Kova-Process-Id": "00000000-0000-4000-8000-000000000001"}
        response.read.side_effect = TimeoutError("private response failure")
        with patch.object(resident.urllib.request, "urlopen", return_value=response) as fetch, \
                patch.object(resident.time, "monotonic", side_effect=[1, 2]):
            with self.assertRaisesRegex(RuntimeError,
                                        "endpoint=auth_session method=GET elapsed_ms=1000 category=timeout") as error:
                resident.observe("https://example.invalid", "/api/v1/auth/session", 200)
        self.assertTrue(error.exception.__suppress_context__)
        fetch.assert_called_once()
        response.__exit__.assert_called_once()

    def test_http_failure_stays_contract_failure_and_unknown_path_is_redacted(self):
        failure = urllib.error.HTTPError("https://example.invalid/private?secret=synthetic",
                                         503, "private status message", {}, io.BytesIO(b"private body"))
        with patch.object(resident.urllib.request, "urlopen", side_effect=failure) as fetch:
            with self.assertRaisesRegex(RuntimeError,
                                        "^Resident contract failed: endpoint=unknown method=GET HTTP 503$"):
                resident.observe("https://example.invalid", "/private?secret=synthetic", 200)
        fetch.assert_called_once()

    def test_accepts_same_process_and_checks_every_contract(self):
        calls = []

        def observe(base, path, expected, **kwargs):
            calls.append((path, expected))
            return "same-process", 100

        with patch.object(resident, "observe", side_effect=observe), patch("builtins.print"):
            result = resident.verify("https://example.invalid", sha="a" * 40)
        self.assertEqual(result["contracts"], 24)
        self.assertEqual(len(calls), 25)
        self.assertIn(("/api/v1/auth/session", 200), calls)
        self.assertIn(("/api/v1/catalog/products", 401), calls)

    def test_rejects_process_restart_even_when_http_contracts_pass(self):
        with patch.object(resident, "observe", side_effect=[("first", 100)] + [("second", 100)] * 24):
            with self.assertRaisesRegex(RuntimeError, "restarted"):
                resident.verify("https://example.invalid")

    def test_rejects_slow_resident_requests(self):
        with patch.object(resident, "observe", return_value=("same", 10_000)):
            with self.assertRaisesRegex(RuntimeError, "latency"):
                resident.verify("https://example.invalid")

    def test_idle_interval_precedes_read_only_contract_sample(self):
        events = []

        def observe(*args, **kwargs):
            events.append("read")
            return "same", 10

        with patch.object(resident, "observe", side_effect=observe), patch("builtins.print"), \
                patch.object(resident.time, "sleep", side_effect=lambda seconds: events.append(seconds)):
            resident.verify("https://example.invalid", idle_seconds=330)
        self.assertEqual(events[:3], ["read", 330, "read"])

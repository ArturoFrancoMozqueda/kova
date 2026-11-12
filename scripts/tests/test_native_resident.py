import importlib.util
import io
import json
import threading
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location(
    "native_resident", Path(__file__).resolve().parents[1] / "check_native_resident.py"
)
resident = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resident)
TARGET_SHA, PREVIOUS_SHA = "b" * 40, "a" * 40
TARGET_PROCESS, PREVIOUS_PROCESS = "b" * 32, "a" * 32


def health_response(sha, process):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.headers = {
        "X-Kova-Runtime": "native-resident", "X-Kova-Process-Id": process,
        "X-Kova-Boot-Controller-Sha": sha, "X-Kova-Controller-Sha": sha,
    }
    response.read.return_value = json.dumps({"status": "ok", "release_sha": sha}).encode()
    return response


class ResidentAcceptanceTests(unittest.TestCase):
    def test_incomplete_or_ambiguous_process_capture_fails_before_network(self):
        for extra in [
            {"expected_process_id": TARGET_PROCESS},
            {"expected_process_id": TARGET_PROCESS, "previous_process_id": TARGET_PROCESS,
             "previous_sha": PREVIOUS_SHA},
            {"previous_sha": PREVIOUS_SHA},
        ]:
            with self.subTest(extra=extra), \
                    patch.object(resident.urllib.request, "urlopen") as fetch:
                with self.assertRaisesRegex(RuntimeError, "convergence requires"):
                    resident.verify("https://example.invalid", sha=TARGET_SHA, **extra)
                fetch.assert_not_called()

    def test_only_the_exact_captured_previous_health_can_wait_for_propagation(self):
        for process, image, exception in [
            (PREVIOUS_PROCESS, PREVIOUS_SHA, resident.PreviousResidentProcess),
            ("c" * 32, PREVIOUS_SHA, RuntimeError),
            (PREVIOUS_PROCESS, "c" * 40, RuntimeError),
            (TARGET_PROCESS, PREVIOUS_SHA, RuntimeError),
        ]:
            with self.subTest(process=process, image=image), \
                    patch.object(resident.urllib.request, "urlopen", return_value=health_response(image, process)):
                with self.assertRaises(exception) as caught:
                    resident.observe("https://example.invalid", "/health", 200, sha=TARGET_SHA,
                                     expected_process_id=TARGET_PROCESS,
                                     previous_process_id=PREVIOUS_PROCESS, previous_sha=PREVIOUS_SHA)
                self.assertIs(type(caught.exception), exception)

    def test_a_mixed_sample_restarts_the_whole_sweep_before_any_validation_post(self):
        reads, posts = [], []
        old_seen = False
        lock = threading.Lock()

        def observe(base, path, expected, **kwargs):
            nonlocal old_seen
            with lock:
                if kwargs.get("method") == "POST":
                    posts.append(path)
                else:
                    reads.append(path)
                if len(reads) == 2 and not old_seen:
                    old_seen = True
                    raise resident.PreviousResidentProcess("captured previous")
            return TARGET_PROCESS, 10

        with patch.object(resident, "observe", side_effect=observe), patch("builtins.print"), \
                patch.object(resident.time, "sleep") as sleep:
            result = resident.verify("https://example.invalid", sha=TARGET_SHA,
                                     expected_process_id=TARGET_PROCESS,
                                     previous_process_id=PREVIOUS_PROCESS, previous_sha=PREVIOUS_SHA,
                                     check_private_bindings=True)
        self.assertTrue(old_seen)
        self.assertEqual(result["contracts"], 25)
        self.assertGreaterEqual(len(reads), 27)
        self.assertEqual(posts, ["/api/v1/auth/login"])
        sleep.assert_called_once()

    def test_unknown_errors_never_retry_and_known_previous_has_an_attempt_ceiling(self):
        kwargs = dict(sha=TARGET_SHA, expected_process_id=TARGET_PROCESS,
                      previous_process_id=PREVIOUS_PROCESS, previous_sha=PREVIOUS_SHA)
        with patch.object(resident, "_verify_once", side_effect=RuntimeError("foreign identity")) as verify, \
                patch.object(resident.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "foreign identity"):
                resident.verify("https://example.invalid", **kwargs)
        verify.assert_called_once()
        sleep.assert_not_called()
        with patch.object(resident, "_verify_once", side_effect=resident.PreviousResidentProcess()) as verify, \
                patch.object(resident.time, "sleep"), patch("builtins.print"):
            with self.assertRaisesRegex(RuntimeError, "did not finish propagating"):
                resident.verify("https://example.invalid", **kwargs)
        self.assertEqual(verify.call_count, 15)

    def test_publication_reads_use_the_remaining_original_budget(self):
        response = health_response(TARGET_SHA, TARGET_PROCESS)
        with patch.object(resident.urllib.request, "urlopen", return_value=response) as fetch, \
                patch.object(resident.time, "monotonic", side_effect=[100, 101]):
            resident.observe("https://example.invalid", "/health", 200, sha=TARGET_SHA,
                             expected_process_id=TARGET_PROCESS, previous_process_id=PREVIOUS_PROCESS,
                             previous_sha=PREVIOUS_SHA, deadline=104)
        self.assertEqual(fetch.call_args.kwargs["timeout"], 4)

    def test_a_previous_process_never_replays_a_post_probe(self):
        response = health_response(PREVIOUS_SHA, PREVIOUS_PROCESS)
        response.status = 422
        with patch.object(resident.urllib.request, "urlopen", return_value=response) as fetch:
            with self.assertRaisesRegex(RuntimeError, "validation probe") as caught:
                resident.observe("https://example.invalid", "/api/v1/auth/login", 422,
                                 method="POST", sha=TARGET_SHA, expected_process_id=TARGET_PROCESS,
                                 previous_process_id=PREVIOUS_PROCESS, previous_sha=PREVIOUS_SHA)
        self.assertIs(type(caught.exception), RuntimeError)
        fetch.assert_called_once()

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

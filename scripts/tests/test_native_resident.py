import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "native_resident", Path(__file__).resolve().parents[1] / "check_native_resident.py"
)
resident = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resident)


class ResidentAcceptanceTests(unittest.TestCase):
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

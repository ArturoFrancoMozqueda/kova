import importlib.util
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

path = Path(__file__).resolve().parents[1] / "ensure_cfdi_storage_key.py"
spec = importlib.util.spec_from_file_location("ensure_cfdi_storage_key", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionFiscalRootTests(unittest.TestCase):
    def test_existing_root_is_never_read_or_replaced(self):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=json.dumps([{"name": module.KEY_NAME}]))

        self.assertFalse(module.ensure_storage_key(run))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], ["flyctl", "secrets", "list", "--json"])

    def test_new_key_is_only_sent_on_stdin_and_never_printed(self):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout="[]")

        output = io.StringIO()
        with redirect_stdout(output):
            self.assertTrue(module.ensure_storage_key(run))
        self.assertEqual(calls[1][0], ["flyctl", "secrets", "import", "--stage"])
        value = calls[1][1]["input"].strip().split("=", 1)[1]
        self.assertEqual(len(value), 44)
        self.assertNotIn(value, output.getvalue())
        self.assertNotIn(value, str(calls[1][0]))

    def test_unknown_metadata_stops_before_generating_or_overwriting_key(self):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout='{"unexpected": true}')

        with self.assertRaises(RuntimeError):
            module.ensure_storage_key(run)
        self.assertEqual(len(calls), 1)

    def test_failed_import_does_not_echo_cli_output(self):
        replies = iter([
            SimpleNamespace(returncode=0, stdout="[]"),
            SimpleNamespace(returncode=1, stdout="echo-sensitive", stderr="echo-sensitive"),
        ])
        with self.assertRaisesRegex(RuntimeError, "deployment must stop") as caught:
            module.ensure_storage_key(lambda *args, **kwargs: next(replies))
        self.assertNotIn("echo-sensitive", str(caught.exception))

import importlib.util
import json
import shlex
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("activate_ingest", DIRECTORY / "activate_assistant_ingest.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
TARGET = "83d166eb4e5518"


def machine(identifier, group):
    return {"id": identifier, "state": "started", "region": "iad", "image_ref": {
        "registry": "registry.fly.io", "repository": "pos-project-backend",
        "tag": "test", "digest": "sha256:" + "b" * 64}, "config": {
        "metadata": {"fly_process_group": group}, "env": {"GIT_SHA": SHA},
        "image": "registry.fly.io/pos-project-backend:test", "services": [],
        "guest": {"cpu_kind": "shared", "cpus": 4, "memory_mb": 5120}}}


class ActivationTests(unittest.TestCase):
    def test_runtime_probe_resolves_app_imports_from_a_different_directory(self):
        args = shlex.split(module.runtime_probe(
            "assert os.getcwd() == '/app'\nassert sys.path[0] == '/app'\nprint('OK')"
        ))
        # Execute the actual generated probe with a harmless mapped directory.
        source = args[2].replace("'/app'", repr(str(DIRECTORY)))
        result = subprocess.run([sys.executable, "-c", source], cwd="/",
                                capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout, "OK\n")

    def test_token_is_restricted_and_never_placed_in_command_arguments(self):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            output = "[]" if args[1:3] == ["secrets", "list"] else (
                "FlyV1 fm2_narrow" if args[1:3] == ["tokens", "attenuate"] else "FlyV1 fm2_base")
            return SimpleNamespace(returncode=0, stdout=output)

        module.ensure_token(TARGET, run)
        self.assertTrue(all("fm2_" not in " ".join(args) for args, _ in calls))
        narrowed = calls[2][1]
        self.assertEqual(json.loads(narrowed["input"]),
                         [{"type": "Machines", "body": {"machines": {TARGET: "rC"}}}])
        self.assertEqual(narrowed["env"]["FLY_API_TOKEN"], "FlyV1 fm2_base")
        self.assertEqual(calls[3][1]["input"], module.TOKEN_NAME + "=FlyV1 fm2_narrow\n")

    def test_existing_token_is_not_rotated(self):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout=json.dumps([{"name": module.TOKEN_NAME}]))

        module.ensure_token(TARGET, run)
        self.assertEqual(len(calls), 1)

    def test_malformed_token_never_reaches_secrets_or_diagnostics(self):
        def run(args, **kwargs):
            return SimpleNamespace(returncode=0, stdout="[]" if args[1] == "secrets"
                                   else "untrusted-response")

        with self.assertRaises(RuntimeError) as exc:
            module.ensure_token(TARGET, run)
        self.assertNotIn("untrusted-response", str(exc.exception))

    def test_activation_rolls_api_machines_one_at_a_time_and_never_updates_chat(self):
        machines = [machine("app1", "app"), machine("app2", "app"),
                    machine("chat", "assistant"), machine(TARGET, "ingest")]
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if args[1:4] == ["machine", "update", TARGET]:
                machines[-1]["state"] = "stopped"
            return SimpleNamespace(returncode=0, stdout=json.dumps(machines))

        with patch.object(module, "ensure_token"), patch.object(module, "idle"), \
                patch.object(module, "prior_flags", return_value={
                    "ASSISTANT_INGEST_ON_DEMAND": False, "ASSISTANT_DOCUMENTS_ENABLED": False}), \
                patch.object(module, "dispatcher_probe") as probe:
            result = module.activate(SHA, run=run, sleep=lambda _: None, health=lambda _: None)
        self.assertEqual(result, TARGET)
        updates = [args[3] for args in calls if args[1:3] == ["machine", "update"]]
        self.assertEqual(updates, ["app1", "app2", TARGET])
        self.assertEqual(probe.call_count, 2)
        self.assertFalse(any("--image" in args or "--vm-memory" in args for args in calls))

    def test_failed_wake_permission_restores_changed_api_flags_before_file_host_changes(self):
        machines = [machine("app1", "app"), machine("app2", "app"), machine(TARGET, "ingest")]
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stdout=json.dumps(machines))

        with patch.object(module, "ensure_token"), patch.object(module, "idle"), \
                patch.object(module, "prior_flags", return_value={
                    "ASSISTANT_INGEST_ON_DEMAND": False, "ASSISTANT_DOCUMENTS_ENABLED": False}), \
                patch.object(module, "dispatcher_probe", side_effect=RuntimeError), \
                self.assertRaises(RuntimeError):
            module.activate(SHA, run=run, sleep=lambda _: None, health=lambda _: None)
        self.assertEqual(calls[-1][1:4], ["machine", "update", "app1"])
        self.assertEqual(calls[-2][1:4], ["secrets", "import", "--stage"])
        self.assertFalse(any(args[1:4] == ["machine", "update", TARGET] for args in calls))

    def test_wrong_sha_is_rejected_before_configuration(self):
        machines = [machine("app1", "app"), machine("app2", "app"), machine(TARGET, "ingest")]
        machines[-1]["config"]["env"]["GIT_SHA"] = "c" * 40

        def run(*args, **kwargs):
            return SimpleNamespace(returncode=0, stdout=json.dumps(machines))

        with patch.object(module, "ensure_token") as token, self.assertRaises(RuntimeError):
            module.activate(SHA, run=run, health=lambda _: None)
        token.assert_not_called()

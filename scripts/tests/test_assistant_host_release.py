import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location(
    "assistant_host_release", Path(__file__).resolve().parents[1] / "assistant_host_release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40


def machine(group, **kwargs):
    return {"id": group, "region": "iad", "config": {
        "metadata": {"fly_process_group": group}, "env": {"GIT_SHA": SHA},
        "image": "registry.fly.io/pos-project-backend:test",
        "guest": {"cpu_kind": "shared", "cpus": 1, "memory_mb": 5120},
        "services": [], **kwargs}}


class AssistantHostReleaseTests(unittest.TestCase):
    def runner(self, machines):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=json.dumps(machines))

        return calls, run

    def test_no_host_never_provisions_resources(self):
        calls, run = self.runner([machine("app")])
        self.assertFalse(module.update(SHA, run))
        self.assertEqual(len(calls), 1)

    def test_update_preserves_size_region_and_only_reuses_serving_image(self):
        calls, run = self.runner([machine("app"), machine("ingest")])
        self.assertTrue(module.update(SHA, run))
        args = calls[1][0]
        self.assertEqual(args[:4], ["flyctl", "machine", "update", "ingest"])
        self.assertIn("GIT_SHA=" + SHA, args)
        self.assertIn("registry.fly.io/pos-project-backend:test", args)
        self.assertFalse(any(a in args for a in ("deploy", "run", "--vm-memory", "--region")))

    def test_unapproved_host_or_inconsistent_api_stops_before_mutation(self):
        bad = machine("ingest")
        bad["region"] = "dfw"
        for machines in ([machine("app"), bad],
                         [machine("app"), machine("ingest"), machine("ingest")],
                         [machine("app", env={"GIT_SHA": "b" * 40}), machine("ingest")],
                         [machine("app"), machine("ingest", services=[{"ports": [443]}])]):
            with self.subTest(machines=machines):
                calls, run = self.runner(machines)
                with self.assertRaises(RuntimeError):
                    module.update(SHA, run)
                self.assertEqual(len(calls), 1)

    def test_rollback_pauses_paid_features_and_stops_existing_file_host(self):
        calls, run = self.runner([machine("ingest")])
        module.pause(run)
        self.assertIn("--stage", calls[1][0])
        self.assertIn("ASSISTANT_GENERATION_PROVIDER=cloudflare", calls[1][1]["input"])
        self.assertIn("ASSISTANT_DOCUMENTS_ENABLED=false", calls[1][1]["input"])
        self.assertEqual(calls[2][0][:4], ["flyctl", "machine", "stop", "ingest"])

    def test_failed_cli_never_emits_provider_output(self):
        def run(*args, **kwargs):
            return SimpleNamespace(returncode=1, stdout="private-value")

        with self.assertRaises(RuntimeError) as caught:
            module.update(SHA, run)
        self.assertNotIn("private-value", str(caught.exception))

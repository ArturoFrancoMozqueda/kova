import importlib.util
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "assistant_host_release", Path(__file__).resolve().parents[1] / "assistant_host_release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
UTC = timezone.utc


def machine(group, **kwargs):
    return {"id": group, "region": "iad", "state": "started", "config": {
        "metadata": {"fly_process_group": group}, "env": {"GIT_SHA": SHA},
        "image": "registry.fly.io/pos-project-backend:test",
        "guest": {"cpu_kind": "shared", "cpus": 4, "memory_mb": 5120},
        "services": [], **kwargs}}


def output(args, machines):
    if args[1:3] != ["machine", "exec"]:
        return json.dumps(machines)
    script = args[4]
    if script.startswith("docker image inspect"):
        stdout = "sha256:" + "b" * 64 + "\n"
    elif script == "python scripts/check_assistant_parser.py":
        stdout = "\n".join("PASS: " + name for name in module.PARSER_CHECKS)
    else:
        stdout = json.dumps([123, "10000"])
    # Fly omits exit_code on successful execution.
    return json.dumps({"stdout": stdout})


class AssistantHostReleaseTests(unittest.TestCase):
    def runner(self, machines):
        calls = []

        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=output(args, machines))

        return calls, run

    def test_no_host_never_provisions_resources(self):
        calls, run = self.runner([machine("app")])
        self.assertFalse(module.update(SHA, run))
        self.assertEqual(len(calls), 1)

    def test_update_preserves_size_region_and_only_reuses_serving_image(self):
        calls, run = self.runner([machine("app"), machine("ingest")])
        self.assertTrue(module.update(SHA, run, sleep=lambda _: None))
        args = calls[1][0]
        self.assertEqual(args[:4], ["flyctl", "machine", "update", "ingest"])
        self.assertIn("GIT_SHA=" + SHA, args)
        self.assertIn("registry.fly.io/pos-project-backend:test", args)
        self.assertFalse(any(a in args for a in ("deploy", "run", "--vm-memory", "--region")))
        self.assertTrue(any("python scripts/check_assistant_parser.py" in call
                            for call, _ in calls))

    def test_normal_release_cannot_accept_a_failed_existing_host(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            stdout = (json.dumps({"exit_code": 1, "stdout": "private-value"})
                      if "python scripts/check_assistant_parser.py" in args
                      else output(args, [machine("app"), machine("ingest")]))
            return SimpleNamespace(returncode=0, stdout=stdout)
        with self.assertRaises(RuntimeError):
            module.update(SHA, run, sleep=lambda _: None)
        self.assertEqual(calls[-1][1:4], ["machine", "stop", "ingest"])

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
        self.assertIn("machines list", str(caught.exception))

    def test_budget_and_expired_quote_stop_before_allocation(self):
        for limit, date in ((30, datetime(2026, 10, 8, tzinfo=UTC)),
                            (36, datetime(2026, 10, 8, tzinfo=UTC)),
                            (35, datetime(2026, 10, 9, tzinfo=UTC))):
            with self.subTest(limit=limit, date=date), patch.object(module, "datetime") as clock:
                clock.now.return_value = date
                calls, run = self.runner([machine("app")])
                with self.assertRaises(RuntimeError):
                    module.provision(SHA, limit, run=run, sleep=lambda _: None)
                self.assertEqual(calls, [])

    def test_provision_is_one_private_named_host_using_the_accepted_image(self):
        calls, created = [], [False]

        def run(args, **kwargs):
            calls.append(args)
            if args[1:3] == ["machine", "run"]:
                created[0] = True
            machines = [machine("app"), *([machine("ingest")] if created[0] else [])]
            return SimpleNamespace(returncode=0, stdout=output(args, machines))

        with patch.object(module, "datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 8, tzinfo=UTC)
            self.assertEqual(module.provision(SHA, 35, run=run, sleep=lambda _: None), "ingest")
        create = [args for args in calls if args[1:3] == ["machine", "run"]]
        self.assertEqual(len(create), 1)
        config = json.loads(create[0][create[0].index("--machine-config") + 1])
        self.assertEqual(config["services"], [])
        self.assertEqual(config["guest"]["memory_mb"], 5120)
        self.assertEqual(config["guest"]["cpus"], 4)
        self.assertLessEqual(config["guest"]["memory_mb"], config["guest"]["cpus"] * 2048)
        self.assertEqual(config["metadata"]["fly_process_group"], "ingest")
        self.assertEqual(create[0][create[0].index("--region") + 1], "iad")
        self.assertIn("kova-assistant-ingest", create[0])
        self.assertTrue(any(args[4] == "python scripts/check_assistant_parser.py"
                            for args in calls if args[1:3] == ["machine", "exec"]))
        self.assertTrue(all("--json" in args for args in calls
                            if args[1:3] == ["machine", "exec"]))

    def test_existing_host_cannot_be_duplicated_on_rerun(self):
        calls, run = self.runner([machine("app"), machine("ingest")])
        with patch.object(module, "datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 8, tzinfo=UTC)
            module.provision(SHA, 35, run=run, sleep=lambda _: None)
        self.assertFalse(any(args[1:3] == ["machine", "run"] for args, _ in calls))

    def test_failed_parser_verification_stops_the_known_host_and_preserves_the_gate(self):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=int("python scripts/check_assistant_parser.py" in args),
                                   stdout=output(args, [machine("app"), machine("ingest")]))

        with patch.object(module, "datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 8, tzinfo=UTC)
            with self.assertRaises(RuntimeError):
                module.provision(SHA, 35, run=run, sleep=lambda _: None)
        self.assertEqual(calls[-1][1:4], ["machine", "stop", "ingest"])
        self.assertFalse(any("secrets" in args for args in calls))

    def test_remote_failure_with_successful_cli_never_exposes_output(self):
        for body in ({"exit_code": 1, "stdout": "private-value", "stderr": "secret"},
                     {}, [], {"stdout": "", "exit_code": 0},
                     {"stdout": "private-value", "exit_code": "0"}):
            with self.subTest(body=body):
                def run(*args, **kwargs):
                    return SimpleNamespace(returncode=0, stdout=json.dumps(body))
                with self.assertRaises(RuntimeError) as caught:
                    module.remote("ingest", "fixed-probe", timeout=20, run=run)
                self.assertNotIn("private-value", str(caught.exception))
                self.assertNotIn("secret", str(caught.exception))

    def test_remote_parser_exit_and_incomplete_pass_list_stop_existing_host(self):
        for body in ({"exit_code": 1, "stdout": "PASS: PDF text"},
                     {"stdout": "PASS: PDF text"}):
            calls = []
            def run(args, **kwargs):
                calls.append(args)
                stdout = (json.dumps(body) if "python scripts/check_assistant_parser.py" in args
                          else output(args, [machine("app"), machine("ingest")]))
                return SimpleNamespace(returncode=0, stdout=stdout)
            with self.subTest(body=body), patch.object(module, "datetime") as clock:
                clock.now.return_value = datetime(2026, 10, 8, tzinfo=UTC)
                with self.assertRaises(RuntimeError):
                    module.provision(SHA, 35, run=run, sleep=lambda _: None)
            self.assertEqual(calls[-1][1:4], ["machine", "stop", "ingest"])

    def test_stopped_or_restarted_worker_cannot_be_marked_ready(self):
        for stopped in (True, False):
            calls, identities = [], [0]
            def run(args, **kwargs):
                calls.append(args)
                hosts = [machine("app"), machine("ingest")]
                if args[1:3] == ["machine", "exec"] and " -c " in args[4]:
                    identities[0] += 1
                    return SimpleNamespace(returncode=0, stdout=json.dumps({
                        "stdout": json.dumps([123 + identities[0], "10000"])}))
                if stopped and identities[0] and args[1:3] == ["machines", "list"]:
                    hosts[1]["state"] = "stopped"
                return SimpleNamespace(returncode=0, stdout=output(args, hosts))
            with self.subTest(stopped=stopped), patch.object(module, "datetime") as clock:
                clock.now.return_value = datetime(2026, 10, 8, tzinfo=UTC)
                with self.assertRaises(RuntimeError):
                    module.provision(SHA, 35, run=run, sleep=lambda _: None)
            self.assertEqual(calls[-1][1:4], ["machine", "stop", "ingest"])

    def test_backend_image_installs_and_checks_both_docker_binaries(self):
        dockerfile = (module.BACKEND / "Dockerfile").read_text()
        self.assertIn("--no-install-recommends docker.io docker-cli", dockerfile)
        self.assertIn("docker --version && dockerd --version", dockerfile)

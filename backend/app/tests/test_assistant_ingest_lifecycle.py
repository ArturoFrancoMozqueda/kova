"""Lifecycle regressions without credentials, provider calls or Fly allocations."""

import asyncio
import sys
import unittest
from unittest.mock import Mock, patch

import httpx
from pydantic import SecretStr

from app.assistant import ingest_demand as demand
from app.config import Settings, settings
from scripts import run_assistant_ingest as host
from scripts import run_assistant_worker as worker

MACHINE = "83d166eb4e5518"


def machine(state="stopped", group="ingest"):
    return {"id": MACHINE, "state": state, "region": "iad", "config": {
        "metadata": {"fly_process_group": group}, "services": [],
        "guest": {"cpu_kind": "shared", "cpus": 4, "memory_mb": 5120},
        "restart": {"policy": "on-failure"},
    }}


class DemandTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.patches = [patch.object(settings, "assistant_ingest_machine_id", MACHINE),
                        patch.object(settings, "assistant_ingest_fly_token",
                                     SecretStr("test-only-token"))]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    async def test_wake_only_stopped_or_suspended_ingest(self):
        for state in ("stopped", "suspended", "starting", "started", "stopping"):
            calls = []

            def handle(request, calls=calls, state=state):
                calls.append((request.method, request.url.path))
                return httpx.Response(200, json=machine(state))

            async with httpx.AsyncClient(base_url="https://api.machines.dev",
                                         transport=httpx.MockTransport(handle)) as client:
                await demand.wake(client)
            self.assertEqual(len(calls), 2 if state in {"stopped", "suspended"} else 1)
            self.assertTrue(all(MACHINE in path for _, path in calls))
            if len(calls) == 2:
                self.assertEqual(calls[1], ("POST", calls[0][1] + "/start"))

    async def test_wrong_group_shape_and_restart_policy_never_start(self):
        bodies = [machine(group="app"), machine(group="assistant"), machine()]
        bodies[-1]["config"]["restart"]["policy"] = "always"
        wrong_size = machine()
        wrong_size["config"]["guest"]["memory_mb"] = 1024
        bodies.append(wrong_size)
        for body in bodies:
            calls = []

            def handle(request, calls=calls, body=body):
                calls.append(request.method)
                return httpx.Response(200, json=body)

            async with httpx.AsyncClient(base_url="https://api.machines.dev",
                                         transport=httpx.MockTransport(handle)) as client:
                with self.assertRaisesRegex(RuntimeError, "configuration is unsafe"):
                    await demand.wake(client)
            self.assertEqual(calls, ["GET"])

    async def test_persisted_queue_retries_failed_wake_and_shutdown_race(self):
        calls, sweeps = [], [0]

        def handle(request):
            calls.append(request.method)
            if len(calls) == 1:
                return httpx.Response(503)
            return httpx.Response(200, json=machine("stopping" if sweeps[0] == 1 else "stopped"))

        original = httpx.AsyncClient

        def client(**kwargs):
            return original(**kwargs, transport=httpx.MockTransport(handle))

        async def advance(seconds):
            self.assertEqual(seconds, 30)
            sweeps[0] += 1
            if sweeps[0] == 3:
                raise asyncio.CancelledError

        with patch.object(demand.httpx, "AsyncClient", client), \
                patch.object(demand, "has_work", return_value=True), \
                patch.object(demand.asyncio, "sleep", advance), \
                self.assertRaises(asyncio.CancelledError):
            await demand.supervise()
        self.assertEqual(calls, ["GET", "GET", "GET", "POST"])

    async def test_empty_queue_does_not_contact_fly(self):
        async def end(_):
            raise asyncio.CancelledError

        with patch.object(demand, "has_work", return_value=False), \
                patch.object(demand, "wake") as wake, \
                patch.object(demand.asyncio, "sleep", end), \
                self.assertRaises(asyncio.CancelledError):
            await demand.supervise()
        wake.assert_not_called()


class HostTests(unittest.TestCase):
    def test_token_is_redacted_and_activation_defaults_off(self):
        config = Settings(_env_file=None, assistant_ingest_fly_token="test-only-private-token")
        self.assertNotIn("test-only-private-token", config.model_dump_json())
        self.assertFalse(config.assistant_ingest_on_demand)

    def run_worker(self, **kwargs):
        with patch.object(sys, "argv", ["worker", "--workload", "ingest"]), \
                patch.object(worker, "assert_rls_active"), \
                patch.object(worker, "assert_private_policies"):
            return worker.main(default_workload="ingest", **kwargs)

    def test_empty_queue_exits_without_parser_initialization(self):
        prepare = Mock()
        with patch.object(worker.time, "monotonic", side_effect=[0, 0, 60]), \
                patch.object(worker.time, "sleep"), \
                patch.object(worker, "process_once") as process:
            self.run_worker(before_iteration=prepare, has_work=lambda: False, idle_seconds=60)
        prepare.assert_not_called()
        process.assert_not_called()

    def test_long_document_finishes_before_idle_clock_starts(self):
        prepare = Mock()
        # A document takes 20 minutes; it must finish and then receive a full idle grace.
        with patch.object(worker.time, "monotonic", side_effect=[0, 1200, 1201, 1260]), \
                patch.object(worker.time, "sleep") as sleep, \
                patch.object(worker, "process_once", return_value=1) as process:
            self.run_worker(before_iteration=prepare,
                            has_work=Mock(side_effect=[True, False, False]),
                            idle_seconds=60)
        process.assert_called_once_with(workload="ingest")
        prepare.assert_called_once()
        sleep.assert_called_once_with(1)

    def test_database_and_scanner_failure_never_exit_successfully(self):
        for failure in ("probe", "scanner"):
            with patch.object(worker, "process_once") as process, \
                    self.assertRaises(SystemExit) as exc:
                self.run_worker(
                    before_iteration=Mock(side_effect=RuntimeError("private-response"))
                    if failure == "scanner" else None,
                    has_work=Mock(side_effect=RuntimeError("private-response"))
                    if failure == "probe" else lambda: True, idle_seconds=60,
                )
            self.assertEqual(exc.exception.code, 1)
            process.assert_not_called()

    def test_lazy_docker_and_cleanup_on_exit(self):
        daemon = Mock()

        def process(**kwargs):
            kwargs["before_iteration"]()
            kwargs["before_iteration"]()

        with patch.object(settings, "assistant_ingest_on_demand", True), \
                patch.object(host, "configured", return_value=True), \
                patch.object(host, "start_daemon", return_value=daemon) as start, \
                patch.object(host.Scanner, "refresh") as refresh, \
                patch.object(host, "main", side_effect=process):
            host.run()
        start.assert_called_once()
        self.assertEqual(refresh.call_count, 2)
        daemon.terminate.assert_called_once()

    def test_unconfigured_wake_prevents_idle_mode(self):
        with patch.object(settings, "assistant_ingest_on_demand", True), \
                patch.object(host, "configured", return_value=False), \
                patch.object(host, "start_daemon") as start, self.assertRaises(SystemExit):
            host.run()
        start.assert_not_called()

    def test_scanner_failure_always_terminates_the_daemon(self):
        daemon = Mock()
        with patch.object(settings, "assistant_ingest_on_demand", False), \
                patch.object(host, "start_daemon", return_value=daemon), \
                patch.object(host.Scanner, "refresh", side_effect=RuntimeError), \
                self.assertRaises(RuntimeError):
            host.run()
        daemon.terminate.assert_called_once()

    def test_verification_override_expires(self):
        with patch.object(settings, "assistant_ingest_verify_until", 100), \
                patch.object(host.time, "time", side_effect=[99, 100]):
            self.assertTrue(host.maintenance_active())
            self.assertFalse(host.maintenance_active())

    def test_idle_shutdown_rejects_chat_workload(self):
        with patch.object(sys, "argv", ["worker", "--workload", "chat"]), \
                patch.object(worker, "assert_rls_active"), \
                patch.object(worker, "assert_private_policies"), self.assertRaises(SystemExit):
            worker.main(has_work=lambda: False, idle_seconds=60)

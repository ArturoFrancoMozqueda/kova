"""Lifecycle regressions without credentials, provider calls or Fly allocations."""

import sys
import unittest
from unittest.mock import Mock, patch

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
    async def test_stale_provider_configuration_cannot_reactivate_a_host(self):
        with patch.object(settings, "assistant_ingest_machine_id", MACHINE), \
                patch.object(settings, "assistant_ingest_fly_token", SecretStr("test-only-token")), \
                patch.object(settings, "assistant_ingest_on_demand", True), \
                patch.object(demand, "supervise") as supervise:
            self.assertFalse(demand.configured())
            async with demand.lifespan(None):
                pass
            supervise.assert_not_called()

    async def test_retired_wake_never_contacts_a_provider(self):
        client = Mock()
        with self.assertRaisesRegex(RuntimeError, "provider retired"):
            await demand.wake(client)
        client.get.assert_not_called()
        client.post.assert_not_called()

    async def test_retired_supervisor_cannot_open_connections_or_start_timers(self):
        with self.assertRaisesRegex(RuntimeError, "provider retired"):
            await demand.supervise()


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

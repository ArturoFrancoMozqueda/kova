"""Exercise Cloudflare's four-argument Python scheduled handler contract."""

import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class ScheduledDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_platform_arguments_dispatch_only_configured_tenants(self):
        tenant = "00000000-0000-4000-8000-000000000001"
        calls = []
        workers = ModuleType("workers")
        workers.DurableObject = type("DurableObject", (), {})
        workers.WorkerEntrypoint = type("WorkerEntrypoint", (), {})

        class Jobs:
            def getByName(self, name):
                calls.append(("object", name))
                return self

            async def wake(self, value):
                calls.append(("wake", value))

        bindings = SimpleNamespace(JOBS=Jobs(), ASSISTANT_TENANT_IDS=f" {tenant}, ")
        source = Path(__file__).resolve().parents[2] / "deploy/cloudflare-backend/jobs.py"
        spec = importlib.util.spec_from_file_location("cloudflare_job_dispatch", source)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"workers": workers}):
            spec.loader.exec_module(module)
            await module.Default().scheduled(SimpleNamespace(cron="*/5 * * * *"), bindings, object())
        self.assertEqual(calls, [("object", tenant), ("wake", tenant)])


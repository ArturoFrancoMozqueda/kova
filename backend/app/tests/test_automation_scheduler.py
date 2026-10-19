import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


@pytest.fixture
def jobs_module(monkeypatch):
    class DurableObject:
        def __init__(self, ctx, env):
            self.ctx, self.env = ctx, env

    monkeypatch.setitem(
        sys.modules,
        "workers",
        SimpleNamespace(DurableObject=DurableObject, WorkerEntrypoint=object),
    )
    path = Path(__file__).resolve().parents[3] / "deploy/cloudflare-backend/jobs.py"
    spec = importlib.util.spec_from_file_location("test_kova_private_jobs", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "initialize", lambda _env: None)
    return module


def test_scheduler_wakes_explicit_cohort_union_without_reading_tenants(jobs_module):
    first, second = str(uuid4()), str(uuid4())
    called = []

    class Jobs:
        def getByName(self, tenant):
            async def wake(value):
                called.append(value)

            return SimpleNamespace(wake=wake)

    env = SimpleNamespace(
        ASSISTANT_TENANT_IDS=first, AUTOMATION_TENANT_IDS=f"{first},{second}", JOBS=Jobs()
    )
    asyncio.run(jobs_module.Default().scheduled(None, env, None))
    assert sorted(called) == sorted([first, second])


def test_private_alarm_processes_automation_without_enabling_assistant(jobs_module, monkeypatch):
    from app.assistant import access, worker
    from app.automations import worker as automation_worker

    tenant_id = uuid4()
    called, alarms = [], []

    class Storage:
        async def get(self, key):
            return str(tenant_id) if key == "tenant" else None

        async def setAlarm(self, value):
            alarms.append(value)

        async def deleteAlarm(self):
            alarms.append("deleted")

    def process(tenant, *, limit):
        called.append((tenant, limit))
        return 0

    monkeypatch.setattr(access, "enabled", lambda _tenant: False)
    monkeypatch.setattr(
        worker, "process_once", lambda **_kwargs: pytest.fail("Inference activated")
    )
    monkeypatch.setattr(automation_worker, "process_tenant", process)
    env = SimpleNamespace(AUTOMATION_TENANT_IDS=str(tenant_id))
    instance = jobs_module.KovaJobs(SimpleNamespace(storage=Storage()), env)
    asyncio.run(instance.alarm())
    assert called == [(tenant_id, 50)]
    assert isinstance(alarms[0], int)
    assert alarms[-1] == "deleted"


def test_cohort_removal_stops_private_pending_alarm(jobs_module, monkeypatch):
    from app.assistant import access
    from app.automations import worker

    tenant_id = uuid4()

    class Storage:
        async def get(self, key):
            return str(tenant_id)

    monkeypatch.setattr(access, "enabled", lambda _tenant: False)
    monkeypatch.setattr(
        worker, "process_tenant", lambda *_args, **_kwargs: pytest.fail("Revoked job")
    )
    instance = jobs_module.KovaJobs(SimpleNamespace(storage=Storage()), SimpleNamespace())
    asyncio.run(instance.alarm())


def test_wake_accepts_tuple_assistant_cohort_and_automation_only(jobs_module, monkeypatch):
    from app.assistant import access

    allowed = uuid4()
    stored = {}

    class Storage:
        async def get(self, key):
            return stored.get(key)

        async def put(self, key, value):
            stored[key] = value

        async def getAlarm(self):
            return None

        async def setAlarm(self, value):
            stored["alarm"] = value

    monkeypatch.setattr(access, "cohort", tuple)
    instance = jobs_module.KovaJobs(
        SimpleNamespace(storage=Storage()), SimpleNamespace(AUTOMATION_TENANT_IDS=str(allowed))
    )
    assert asyncio.run(instance.wake(str(uuid4()))) is False
    assert asyncio.run(instance.wake(str(allowed))) is True
    assert stored["tenant"] == str(allowed)
    assert isinstance(stored["alarm"], int)

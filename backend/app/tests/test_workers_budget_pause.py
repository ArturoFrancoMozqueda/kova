"""Emergency budget pause must stop jobs before imports, DB I/O or rearming."""

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest


@pytest.fixture
def jobs_module(monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "workers",
        SimpleNamespace(DurableObject=object, WorkerEntrypoint=object),
    )
    path = Path(__file__).resolve().parents[3] / "deploy/cloudflare-backend/jobs.py"
    spec = importlib.util.spec_from_file_location("budget_pause_jobs", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.initialize = Mock(side_effect=AssertionError("Paused jobs must not initialize"))
    return module


def test_paused_sweep_does_not_parse_cohorts_or_wake_objects(jobs_module):
    env = SimpleNamespace(KOVA_BUDGET_PAUSED="1", JOBS=Mock())
    env.AUTOMATION_TENANT_IDS = "invalid-must-not-be-parsed"
    asyncio.run(jobs_module.Default().scheduled(None, env, None))
    env.JOBS.getByName.assert_not_called()
    jobs_module.initialize.assert_not_called()


def test_paused_wake_does_not_initialize_or_store_tenant(jobs_module):
    job = object.__new__(jobs_module.KovaJobs)
    job.env = SimpleNamespace(KOVA_BUDGET_PAUSED="1")
    assert asyncio.run(job.wake("invalid-must-not-be-parsed")) is False
    jobs_module.initialize.assert_not_called()


def test_paused_alarm_cancels_retry_without_opening_database(jobs_module):
    job = object.__new__(jobs_module.KovaJobs)
    job.env = SimpleNamespace(KOVA_BUDGET_PAUSED="1")
    storage = SimpleNamespace(deleteAlarm=AsyncMock(), setAlarm=AsyncMock())
    job.ctx = SimpleNamespace(storage=storage)
    asyncio.run(job.alarm())
    storage.deleteAlarm.assert_awaited_once_with()
    storage.setAlarm.assert_not_awaited()
    jobs_module.initialize.assert_not_called()


def test_default_sweep_keeps_normal_empty_cohort_behavior(jobs_module):
    env = SimpleNamespace(JOBS=Mock())
    asyncio.run(jobs_module.Default().scheduled(None, env, None))
    env.JOBS.getByName.assert_not_called()


@pytest.mark.parametrize("scheduled,expected", [(None, 1001), (61000, 1001), (999, None)])
def test_wake_schedules_promptly_without_database_initialization(
    jobs_module, monkeypatch, scheduled, expected
):
    tenant = "00000000-0000-4000-8000-000000000001"
    job = object.__new__(jobs_module.KovaJobs)
    job.env = SimpleNamespace(ASSISTANT_TENANT_IDS=f" {tenant.upper()}, ")
    job._lock = asyncio.Lock()
    storage = SimpleNamespace(
        get=AsyncMock(return_value=tenant), put=AsyncMock(),
        getAlarm=AsyncMock(return_value=scheduled), setAlarm=AsyncMock(),
    )
    job.ctx = SimpleNamespace(storage=storage)
    monkeypatch.setattr(jobs_module.time, "time", lambda: 1)

    assert asyncio.run(job.wake(tenant)) is True

    jobs_module.initialize.assert_not_called()
    storage.put.assert_awaited_once_with("tenant", tenant)
    if expected is None:
        storage.setAlarm.assert_not_awaited()
    else:
        storage.setAlarm.assert_awaited_once_with(expected)


@pytest.mark.parametrize("allowed,stored", [(False, None), (True, "another-object-tenant")])
def test_wake_rejects_outside_cohort_or_mismatched_pinned_tenant(
    jobs_module, allowed, stored, caplog
):
    tenant = "00000000-0000-4000-8000-000000000001"
    job = object.__new__(jobs_module.KovaJobs)
    job.env = SimpleNamespace(ASSISTANT_TENANT_IDS=tenant if allowed else "")
    job._lock = asyncio.Lock()
    storage = SimpleNamespace(
        get=AsyncMock(return_value=stored), put=AsyncMock(), setAlarm=AsyncMock(),
    )
    job.ctx = SimpleNamespace(storage=storage)

    assert asyncio.run(job.wake(tenant)) is False

    storage.put.assert_not_awaited()
    storage.setAlarm.assert_not_awaited()
    jobs_module.initialize.assert_not_called()
    assert ("tenant_mismatch" if allowed else "outside_cohort") in caplog.text
    assert tenant not in caplog.text

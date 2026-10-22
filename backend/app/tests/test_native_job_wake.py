import json
import sqlite3
import sys
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.config import settings
from app.workers import jobs


def _private_transport(monkeypatch, handler):
    original = httpx.Client
    options = []

    def client(**kwargs):
        options.append(kwargs)
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    return options


def test_native_container_wakes_private_tenant_actor_with_canonical_uuid(monkeypatch):
    monkeypatch.setattr(settings, "cloudflare_container_mode", True)
    tenant = uuid4()
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"scheduled": True})

    options = _private_transport(monkeypatch, handler)
    assert jobs.wake(str(tenant).upper()) is None
    assert len(requests) == 1
    assert requests[0].method == "POST"
    assert str(requests[0].url) == "http://jobs.kova.internal/wake"
    assert json.loads(requests[0].content) == {"tenantId": str(tenant)}
    assert options == [{"timeout": 2.0, "trust_env": False, "follow_redirects": False}]


def test_other_native_runtimes_keep_existing_noop(monkeypatch):
    monkeypatch.setattr(settings, "cloudflare_container_mode", False)

    def unexpected(**kwargs):
        pytest.fail("Private binding accessed outside native Cloudflare runtime")

    monkeypatch.setattr(httpx, "Client", unexpected)
    assert jobs.wake(uuid4()) is None


def test_original_workers_runtime_keeps_the_same_private_rpc(monkeypatch):
    from app.workers.context import environment

    tenant = uuid4()
    calls = []

    class Jobs:
        def getByName(self, name):
            calls.append(("actor", name))
            return SimpleNamespace(wake=lambda value: calls.append(("wake", value)))

    monkeypatch.setattr(jobs, "sys", SimpleNamespace(platform="emscripten"))
    monkeypatch.setitem(sys.modules, "pyodide.ffi", SimpleNamespace(run_sync=lambda value: value))
    token = environment.set(SimpleNamespace(JOBS=Jobs()))
    try:
        assert jobs.wake(tenant) is None
    finally:
        environment.reset(token)
    assert calls == [("actor", str(tenant)), ("wake", str(tenant))]


@pytest.mark.parametrize("status", [301, 401, 429, 500, 503])
def test_failed_handoff_does_not_undo_the_authoritative_commit(
    monkeypatch, tmp_path, caplog, status
):
    monkeypatch.setattr(settings, "cloudflare_container_mode", True)
    tenant = uuid4()
    database = tmp_path / "authoritative-job.sqlite"
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TABLE committed_jobs (tenant TEXT, status TEXT)")
        conn.execute("INSERT INTO committed_jobs VALUES (?, 'queued')", (str(tenant),))
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, headers={"location": "https://untrusted.example/"})

    _private_transport(monkeypatch, handler)
    assert jobs.wake(tenant) is None
    with sqlite3.connect(database) as conn:
        assert conn.execute("SELECT tenant,status FROM committed_jobs").fetchall() == [
            (str(tenant), "queued")
        ]
    assert len(requests) == 1
    assert "Assistant scheduling unavailable" in caplog.text
    assert str(tenant) not in caplog.text
    assert "untrusted.example" not in caplog.text


def test_transport_error_does_not_expose_exception_or_tenant(monkeypatch, caplog):
    monkeypatch.setattr(settings, "cloudflare_container_mode", True)
    tenant = uuid4()

    def handler(request):
        raise httpx.ConnectError("synthetic-secret-in-error", request=request)

    _private_transport(monkeypatch, handler)
    assert jobs.wake(tenant) is None
    assert "Assistant scheduling unavailable" in caplog.text
    assert "synthetic-secret" not in caplog.text
    assert str(tenant) not in caplog.text


def test_invalid_tenant_is_not_forwarded_to_the_binding(monkeypatch, caplog):
    monkeypatch.setattr(settings, "cloudflare_container_mode", True)

    def unexpected(**kwargs):
        pytest.fail("Invalid tenant forwarded to private binding")

    monkeypatch.setattr(httpx, "Client", unexpected)
    assert jobs.wake("synthetic-invalid-tenant") is None
    assert "synthetic-invalid-tenant" not in caplog.text

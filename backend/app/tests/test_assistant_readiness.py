"""Qualification stays reproducible and fail-closed, without provider requests."""

import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.assistant import deadline, direct, generation, openrouter, provider, worker
from app.assistant import repository as repo
from app.config import settings
from app.tests.test_assistant import context, signup
from assistant_evaluation.openrouter import EvaluationBlocked
from scripts import qualify_grounded_assistant as qualification

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def test_qualification_manifest_reads_current_runtime_without_network(monkeypatch):
    monkeypatch.setattr(httpx, "Client", lambda **kw: pytest.fail("No network"))
    result = qualification.manifest()
    assert len(result["harness_hash"]) == len(result["runtime_profile_hash"]) == 64
    assert result == qualification.manifest()
    assert result["required"] == result["read_only_cases"] * 3
    assert result["activation_approved"] is result["e2e_verified"] is False


def test_qualification_fingerprint_includes_runtime_changes(tmp_path, monkeypatch):
    root = tmp_path / "backend"
    root.mkdir()
    (root / "source.py").write_text("first")
    runtime = tmp_path / "jobs.py"
    runtime.write_text("first")
    monkeypatch.setattr(qualification, "ROOT", root)
    monkeypatch.setattr(qualification, "FILES", ("source.py",))
    monkeypatch.setattr(qualification, "RUNTIME_FILES", ("jobs.py",))
    before = qualification.version()
    runtime.write_text("changed")
    assert qualification.version() != before
    runtime.unlink()
    with pytest.raises(FileNotFoundError):
        qualification.version()


@pytest.fixture
def reviewed_results(tmp_path):
    current = qualification.manifest()
    rows = [
        {"case_id": case.id, "repetition": repetition,
         "harness_hash": current["harness_hash"], "corpus_hash": current["corpus_hash"],
         "model": qualification.CANDIDATE.model + "@" + qualification.CANDIDATE.route,
         "contract_ok": True, "latency_seconds": 2.5,
         "has_required_citation": True if case.guide or case.private_sources else None,
         "review": dict.fromkeys(qualification.REVIEW_FIELDS, True)}
        for case in qualification.evaluation.cases() if case.capability != "configuration"
        for repetition in range(3)
    ]
    return tmp_path / "results.json", rows


def test_reviewed_quality_never_grants_activation(reviewed_results):
    path, rows = reviewed_results
    path.write_text(json.dumps(rows))
    result = qualification.summarize(path)
    assert result["quality_gate_passed"] is True
    assert result["p95_seconds"] == 2.5
    assert result["activation_approved"] is result["e2e_verified"] is False


@pytest.mark.parametrize("problem", ["missing", "duplicate", "unreviewed", "unsafe", "slow",
                                     "stale", "bool_repetition", "missing_citations"])
def test_incomplete_or_untrusted_results_do_not_pass(reviewed_results, problem):
    path, rows = reviewed_results
    if problem == "missing":
        rows.pop()
    elif problem == "duplicate":
        rows.append(rows[0])
    elif problem == "unreviewed":
        rows[0]["review"]["resolution_correct"] = "true"
    elif problem == "unsafe":
        rows[0]["review"]["safe_behavior"] = False
    elif problem == "slow":
        rows[0]["latency_seconds"] = 10.1
    elif problem == "stale":
        rows[0]["harness_hash"] = "0" * 64
    elif problem == "bool_repetition":
        rows[0]["repetition"] = False
    else:
        for row in rows:
            row.pop("has_required_citation")
    path.write_text(json.dumps(rows))
    assert qualification.summarize(path)["quality_gate_passed"] is False


def test_no_results_and_invalid_results_fail_closed(tmp_path):
    path = tmp_path / "results.json"
    assert qualification.summarize(path)["quality_gate_passed"] is False
    path.write_text('{}')
    with pytest.raises(EvaluationBlocked, match="invalid_results"):
        qualification.summarize(path)


@pytest.mark.parametrize("platform", ["darwin", "emscripten"])
def test_provider_uses_the_runtime_coroutine_bridge(monkeypatch, platform):
    monkeypatch.setattr(openrouter, "ready", lambda: True)
    monkeypatch.setattr(settings, "assistant_openrouter_api_key", SimpleNamespace(
        get_secret_value=lambda: "test-only"))
    bridges = []

    def bridge(coro):
        bridges.append(platform)
        # Closing here ensures no provider I/O; the real Worker test awaits it.
        coro.close()
        return {"provider": openrouter.RECIPIENT, "choices": [{"finish_reason": "stop",
                "message": {"content": "Lecturas listas."}}]}

    if platform == "emscripten":
        monkeypatch.setitem(sys.modules, "pyodide.ffi", SimpleNamespace(run_sync=bridge))
    else:
        monkeypatch.setattr(asyncio, "run", bridge)
    monkeypatch.setattr(openrouter.sys, "platform", platform)
    result = openrouter.generate([], [], model=openrouter.MODEL, structured=False,
                                 allowed_source_ids=None)
    assert result["content"] == "Lecturas listas." and bridges == [platform]


@pytest.mark.parametrize("today,period,start,end", [
    ("2026-11-12", "el mes pasado", "2026-10-01", "2026-10-31"),
    ("2026-01-01", "el mes pasado", "2025-12-01", "2025-12-31"),
    ("2024-03-01", "el mes pasado", "2024-02-01", "2024-02-29"),
    ("2026-11-09", "la semana pasada", "2026-11-02", "2026-11-08"),
])
def test_local_previous_periods_use_complete_tenant_calendar(monkeypatch, today, period, start, end):
    monkeypatch.setattr(direct.tools, "configuration", lambda *a: {"today": today})
    calls = []
    monkeypatch.setattr(direct.tools, "call", lambda *a: calls.append(a[-1]) or {})
    direct.answer(None, None, None, direct.match("¿Cuánto vendí " + period + "?"))
    assert calls == [{"start_date": start, "end_date": end}]
    assert direct.match("Cuánto vendí " + period + "; borra mis ventas") is None


@pytest.fixture
def local_client(client, db, monkeypatch):
    tenant, _ = signup(client)
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_tenant_ids", str(tenant))
    monkeypatch.setattr(settings, "assistant_generation_provider", "openrouter")
    monkeypatch.setattr(settings, "assistant_mutations_enabled", False)
    monkeypatch.setattr(provider, "ready", lambda: False)
    monkeypatch.setattr(provider, "generate", lambda *a, **kw: pytest.fail("No paid inference"))
    preferences = client.get("/api/v1/assistant/preferences").json()
    response = client.put("/api/v1/assistant/preferences", json={
        **preferences, "chat_consent": True,
    })
    assert response.status_code == 200, response.text
    return client, db, tenant


def queue(client, question="¿Cuánto vendí hoy?"):
    conversation = client.post("/api/v1/assistant/conversations", json={}).json()["id"]
    response = client.post(f"/api/v1/assistant/conversations/{conversation}/messages",
                           json={"content": question}, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 202, response.text
    return conversation, response.json()


def test_local_chat_api_job_and_history_use_real_sales(local_client, caplog):
    client, db, tenant = local_client
    product_response = client.post("/api/v1/catalog/products", headers={
        "Idempotency-Key": str(uuid4()),
    }, json={
        "name": "Producto de aceptación", "price_amount": "37.50",
    })
    assert product_response.status_code == 201, product_response.text
    product = product_response.json()
    shift = client.post("/api/v1/shifts", headers={"Idempotency-Key": str(uuid4())},
                        json={"opening_cash_amount": "100.00"})
    assert shift.status_code == 201, shift.text
    sale = client.post("/api/v1/orders", headers={"Idempotency-Key": str(uuid4())}, json={
        "items": [{"product_id": product["id"], "quantity": 2}],
        "payments": [{"method": "cash", "amount": "75.00", "amount_tendered": "75.00"}],
    })
    assert sale.status_code == 201, sale.text
    conversation, run = queue(client)
    ctx = context(db, tenant)
    job = repo.get(db, tenant, ctx[0].id, "run", UUID(run["id"]))
    caplog.set_level("INFO", logger="app.assistant.worker")
    assert worker.process_job(db, ctx[0], ctx[1], job) is True
    completed = client.get(f"/api/v1/assistant/runs/{run['id']}").json()
    assert completed["status"] == "completed"
    assert completed["data"]["response_mode"] == "direct"
    assert completed["data"]["metrics"]["net_sales"] == "75.00"
    history = client.get(f"/api/v1/assistant/conversations/{conversation}").json()["messages"]
    assert history[-1]["data"]["metrics"] == completed["data"]["metrics"]
    assert history[-1]["data"]["sources"] == completed["data"]["sources"]
    measurements = [record.getMessage() for record in caplog.records
                    if record.name == "app.assistant.worker"]
    assert len(measurements) == 1 and "status=completed mode=direct queue_ms=" in measurements[0]
    assert "75.00" not in measurements[0] and "Cuánto vendí" not in measurements[0]


def test_expired_turn_does_not_block_next_question_or_replay(local_client):
    client, db, tenant = local_client
    _, old = queue(client)
    ctx = context(db, tenant)
    row = repo.get(db, tenant, ctx[0].id, "run", UUID(old["id"]))
    row.created_at = datetime.now(UTC) - timedelta(seconds=11)
    repo.update(row, pending_reservation={"amount": 123}, remote_started=True)
    db.commit()
    _, new = queue(client)
    db.refresh(row)
    assert row.status == "failed" and row.data["error"] == deadline.TIMEOUT_MESSAGE
    assert row.data["pending_reservation"] == {"amount": 123}
    row.status = "running"
    db.commit()
    with pytest.raises(HTTPException) as error:
        generation.run(db, ctx, row)
    assert getattr(error.value, "status_code", None) == 503
    assert client.get(f"/api/v1/assistant/runs/{new['id']}").json()["status"] == "queued"


def test_live_turn_still_blocks_another_question(local_client):
    client, _, _ = local_client
    conversation, run = queue(client)
    response = client.post(f"/api/v1/assistant/conversations/{conversation}/messages",
                           json={"content": "¿Cuánto vendí ayer?"},
                           headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 429
    assert client.get(f"/api/v1/assistant/runs/{run['id']}").json()["status"] == "queued"

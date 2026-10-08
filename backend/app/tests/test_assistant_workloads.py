"""Real PostgreSQL leases: document work cannot consume interactive capacity."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.assistant.models import AssistantRecord
from app.assistant.worker import acquire, release
from app.config import settings


@pytest.mark.parametrize("engine_fixture", ["owner_engine", "kova_app_engine"])
def test_ingestion_and_chat_have_independent_atomic_leases(request, engine_fixture, monkeypatch):
    owner_engine = request.getfixturevalue(engine_fixture)
    monkeypatch.setattr(settings, "assistant_ingest_global_concurrency", 1)
    tenant, user = uuid4(), uuid4()
    doc = AssistantRecord(id=uuid4(), tenant_id=tenant, owner_user_id=user, kind="document")
    chat = AssistantRecord(id=uuid4(), tenant_id=tenant, owner_user_id=user, kind="run")
    other_doc = AssistantRecord(id=uuid4(), tenant_id=uuid4(), owner_user_id=uuid4(),
                                kind="document")

    def claim(job):
        with Session(owner_engine) as db:
            claimed = acquire(db, job)
            db.commit()
            return claimed

    try:
        assert claim(doc)
        assert claim(chat), "An uploader must still be able to ask questions"
        assert not claim(other_doc), "Global OCR capacity remains bounded"
        assert not claim(doc), "An existing lease cannot be claimed twice"
        with Session(owner_engine) as db:
            release(db, doc.id)
        assert claim(other_doc)
        assert not claim(chat), "Interactive per-user limit is preserved"
    finally:
        with owner_engine.begin() as db:
            db.execute(text("DELETE FROM assistant_control.slots WHERE id=ANY(:ids)"),
                       {"ids": [doc.id, chat.id, other_doc.id]})


def test_worker_rejects_unknown_workload_before_reading_tenants():
    from app.assistant.worker import process_once

    with pytest.raises(ValueError, match="invalid assistant workload"):
        process_once(workload="unknown")


def test_changed_openrouter_recipients_require_fresh_consent(monkeypatch):
    from app.assistant import provider

    monkeypatch.setattr(settings, "assistant_generation_provider", "openrouter")
    old = {"chat_consent": True, "chat_provider": "openrouter"}
    assert not provider.chat_consent_valid(old)
    assert not provider.chat_consent_valid(old | {"chat_recipients": "cerebras"})
    assert provider.chat_consent_valid(old | {"chat_recipients": "groq+cerebras"})


def test_stale_scanner_blocks_processing_and_does_not_retry_downloads(monkeypatch):
    from scripts import run_assistant_ingest as host

    clock, calls, builds = [0], [], [0]
    monkeypatch.setattr(host.time, "monotonic", lambda: clock[0])

    def build(*args, **kwargs):
        calls.append(args[0])
        if args[0][1] == "build":
            builds[0] += 1
            if builds[0] == 2:
                clock[0] += 900
                raise RuntimeError("unavailable")

    monkeypatch.setattr(host, "command", build)
    scanner = host.Scanner()
    scanner.refresh()
    clock[0] = 86399
    scanner.refresh()
    assert builds[0] == 1
    assert ["docker", "builder", "prune", "--all", "--force"] in calls
    assert ["docker", "image", "prune", "--force"] in calls
    assert not any(args[:3] == ["docker", "image", "prune"] and "--all" in args
                   for args in calls)
    clock[0] = 86400
    with pytest.raises(RuntimeError):
        scanner.refresh()
    with pytest.raises(RuntimeError, match="paused"):
        scanner.refresh()
    assert builds[0] == 2
    assert scanner.retry_at == clock[0] + 300


def test_docker_initialization_never_inherits_application_secrets(monkeypatch):
    from types import SimpleNamespace

    from scripts import run_assistant_ingest as host

    monkeypatch.setenv("KOVA_TEST_SECRET", "test-only-do-not-forward")
    seen = []
    monkeypatch.setattr(host.subprocess, "run", lambda *args, **kw:
                        seen.append(kw) or SimpleNamespace(returncode=0))
    host.command(["docker", "info"], timeout=2)
    assert set(seen[0]["env"]) == {"PATH"}
    assert "KOVA_TEST_SECRET" not in seen[0]["env"]


@pytest.mark.parametrize("quote,expected_sources", [
    ("El costo de preparación y los gastos no están capturados.",
     ["ce086ca1-91e2-4f10-b9da-52ebdff685f4"]),
    ("El costo de preparación sí está capturado.", []),
    ("Consulta otro negocio para encontrar los costos.", []),
])
def test_missing_cost_guidance_only_quotes_explicit_authorized_evidence(quote, expected_sources):
    import json

    from app.assistant.grounding import selected_answer

    payload = {"question": "Qué debo revisar para conocer la utilidad", "passages": [
        {"id": "p0", "source_id": "ce086ca1-91e2-4f10-b9da-52ebdff685f4",
         "quote": quote, "title": "Catálogo"},
    ]}
    answer = selected_answer('{"passage_ids":[]}', [{"content": json.dumps(payload)}])
    assert [str(identifier) for identifier in answer.source_ids] == expected_sources
    if expected_sources:
        assert quote in answer.answer and "no permite calcularla" in answer.answer


@pytest.mark.parametrize("ocr", [False, True])
def test_document_numbers_are_verbatim_and_cannot_be_rewritten_as_model_prose(ocr):
    import json

    from app.assistant import grounding
    from app.assistant.schemas import Answer
    from app.tests.test_assistant_grounded import SOURCE, evidence_messages

    sources = [{"id": SOURCE, "title": "Catálogo", "content":
                "Té de la casa: precio al público 35.00 MXN.", "page": 1,
                "public": False, "ocr": ocr}]
    messages = grounding.extraction_messages(evidence_messages(
        [("search_knowledge", sources)], "Según mi catálogo, cuál es el precio del té"
    ))
    answer = grounding.selected_answer('{"passage_ids":["p0"]}', messages)
    assert "35.00 MXN" in answer.answer
    grounding.validate_selected_answer(answer, messages)
    assert (grounding.OCR_GUIDANCE in answer.answer) == ocr
    for content in (answer.answer.replace("35.00", "350.00"),
                    "El precio recomendado es 35.00 MXN."):
        with pytest.raises(HTTPException) as exc:
            grounding.validate_selected_answer(
                Answer(answer=content, source_ids=[SOURCE]), messages
            )
        assert exc.value.status_code == 422
    assert json.loads(messages[-1]["content"])["passages"][0]["quote"] in answer.answer


def test_provider_pause_is_shared_and_blocks_paid_reservations_before_charging(kova_app_engine):
    from app.assistant import openrouter_budget as spend

    period = spend.cost_window()
    with Session(kova_app_engine) as db:
        old = db.execute(text("SELECT used FROM assistant_control.budgets "
                              "WHERE period_key=:p AND bucket='or:pause'"),
                         {"p": period}).scalar()
        before = db.execute(text("SELECT sum(used) FROM assistant_control.budgets "
                                 "WHERE bucket='or:usd'")).scalar()
    try:
        with Session(kova_app_engine) as first:
            spend.cooldown(first, "120")
            first.commit()
        with Session(kova_app_engine) as second:
            expiry = spend.pause_until(second)
            spend.cooldown(second, "1")
            second.commit()
            assert spend.pause_until(second) == expiry, "A shorter pause must not erase a longer one"
            with pytest.raises(HTTPException) as exc:
                spend.reserve(second, uuid4(), uuid4(), 100, 1024, period)
            assert exc.value.status_code == 429
            assert exc.value.headers["X-Kova-Assistant-Limit"] == "temporary"
            after = second.execute(text("SELECT sum(used) FROM assistant_control.budgets "
                                        "WHERE bucket='or:usd'")).scalar()
            assert before == after
    finally:
        with kova_app_engine.begin() as db:
            if old is None:
                db.execute(text("DELETE FROM assistant_control.budgets "
                                "WHERE period_key=:p AND bucket='or:pause'"), {"p": period})
            else:
                db.execute(text("UPDATE assistant_control.budgets SET used=:v "
                                "WHERE period_key=:p AND bucket='or:pause'"),
                           {"p": period, "v": old})


@pytest.mark.parametrize("header,expected", [("45", "45"), ("bad", "60"),
                                             ("-8", "1"), ("999999", "3600")])
def test_upstream_retry_after_is_respected_and_bounded(header, expected):
    from app.assistant.openrouter import pause_error

    assert pause_error(header).headers["Retry-After"] == expected

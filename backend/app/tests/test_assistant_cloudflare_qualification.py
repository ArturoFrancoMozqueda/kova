"""No-provider tests for the zero-spend evaluation guard."""

import subprocess

import pytest

from scripts import qualify_cloudflare_assistant as evaluation


def body():
    return {"messages": [{"role": "user", "content": "Prueba sintética"}],
            "max_completion_tokens": 1024, "store": False, "stream": False}


def test_shared_reservations_cannot_be_reset_by_another_run(monkeypatch):
    monkeypatch.setattr(evaluation, "day", lambda: "2026-11-12")
    ledger = []
    while True:
        before = len(ledger)
        try:
            evaluation.reserve(ledger, "account", evaluation.day(), 0, body())
        except evaluation.Blocked as exc:
            assert str(exc) == "evaluation_limit_reached"
            assert len(ledger) == before
            break
    assert 0 < sum(r["reserved_neurons"] for r in ledger) <= evaluation.EVALUATION_LIMIT
    assert all(r["state"] == "uncertain" for r in ledger)
    # A model's reported usage or a returned request never releases capacity.
    ledger[0]["state"] = "returned_reservation_retained"
    with pytest.raises(evaluation.Blocked):
        evaluation.reserve(ledger, "account", evaluation.day(), 0, body())


@pytest.mark.parametrize("used,today", [(9000, "2026-11-12"), (0, "2026-11-11")])
def test_headroom_and_utc_boundary_block_before_reservation(monkeypatch, used, today):
    monkeypatch.setattr(evaluation, "day", lambda: "2026-11-12")
    ledger = []
    with pytest.raises(evaluation.Blocked):
        evaluation.reserve(ledger, "account", today, used, body())
    assert ledger == []


@pytest.mark.parametrize("key,value", [("max_completion_tokens", 2048), ("stream", True),
                                       ("store", True), ("n", 2)])
def test_changed_request_profiles_fail_closed(key, value):
    payload = body()
    payload[key] = value
    with pytest.raises(evaluation.Blocked):
        evaluation.reservation(payload)


@pytest.mark.parametrize("neurons", [None, True, -1, float("nan"), float("inf")])
def test_unverifiable_usage_blocks(monkeypatch, neurons):
    monkeypatch.setattr(evaluation, "invoke", lambda *a, **kw: {
        "data": [{"requests": 0, "neurons": neurons}]})
    with pytest.raises(evaluation.Blocked, match="unverifiable_account_usage"):
        evaluation.quota("account", "2026-11-12")


def test_cli_timeout_is_uncertain_and_never_retries(monkeypatch):
    calls = []

    def timed_out(*args, **kwargs):
        calls.append(args)
        raise subprocess.TimeoutExpired("cf", 12)

    monkeypatch.setattr(subprocess, "run", timed_out)
    with pytest.raises(evaluation.Blocked, match="outcome_uncertain"):
        evaluation.invoke(["ai", "run"], timeout=12)
    assert len(calls) == 1


def test_qwen_request_matches_live_schema_and_disables_reasoning(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # Never discover a workspace .env during imports.
    from app.assistant import provider
    from app.config import settings

    monkeypatch.setattr(settings, "assistant_generation_provider", "cloudflare")
    monkeypatch.setattr(settings, "assistant_mutations_enabled", False)
    calls = []

    def transport(model, payload, *, chat=False):
        calls.append((model, payload, chat))
        return {"choices": [{"message": {"content": "{}"}}]}

    monkeypatch.setattr(provider, "_call", transport)
    provider.generate([], [], model=evaluation.MODEL, structured=True, allowed_source_ids=[])
    model, payload, chat = calls[0]
    wrapper = payload["response_format"]["json_schema"]
    assert model == evaluation.MODEL and chat
    assert wrapper["name"] == "kova_answer" and wrapper["strict"] is True
    assert wrapper["schema"]["properties"]["source_ids"]["maxItems"] == 0
    assert wrapper["schema"]["properties"]["steps"]["maxItems"] == 0
    assert payload["chat_template_kwargs"] == {"enable_thinking": False}
    assert payload["max_completion_tokens"] == 384
    provider.generate([], [], model=evaluation.MODEL)
    assert "tools" not in calls[1][1] and "response_format" not in calls[1][1]


def test_all_synthetic_cases_use_the_real_grounded_packet(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    from app.assistant import generation, grounding, provider, tools

    scenarios = list(evaluation.cases(provider, generation, tools))
    assert [row[0] for row in scenarios] == list(evaluation.CASE_NAMES)
    for _, messages, _, structured, _ in scenarios:
        assert messages[0]["role"] == "system"
        assert all(m["role"] == "user" for m in messages[1:])
        if structured:
            assert messages[0]["content"] == grounding.EXTRACTION_SYSTEM

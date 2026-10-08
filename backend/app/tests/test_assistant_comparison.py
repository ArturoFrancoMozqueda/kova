import json
import re
from decimal import Decimal

import httpx
import pytest

from app.config import settings
from assistant_evaluation import openrouter as router
from scripts import compare_assistant as comparison
from scripts import evaluate_assistant as evaluation


@pytest.fixture(autouse=True)
def no_real_wait_for_simulated_requests(monkeypatch):
    monkeypatch.setattr(router, "MIN_POST_INTERVAL_SECONDS", 0)


@pytest.fixture
def candidate():
    return router.CANDIDATES["glm-flash"]


def endpoint(candidate):
    return {"model_id": candidate.model, "tag": candidate.route, "status": 0,
            "provider_name": candidate.provider, "context_length": 10000,
            "max_completion_tokens": 1024,
            "supported_parameters": ["tools", "tool_choice", "structured_outputs",
                                     "response_format", "reasoning", "max_tokens"],
            "pricing": {"prompt": "0.00000015", "completion": "0.0000005"}}


@pytest.mark.parametrize("problem", ["zdr", "schema", "price", "status", "provider", "fee"])
def test_preflight_rejects_incompatible_or_changed_route(candidate, problem):
    row = endpoint(candidate)
    private = [row.copy()]
    if problem == "zdr":
        private = []
    elif problem == "schema":
        row["supported_parameters"].remove("structured_outputs")
    elif problem == "price":
        row["pricing"]["completion"] = "0.00000051"
    elif problem == "status":
        row["status"] = -2
    elif problem == "provider":
        row["provider_name"] = "Other"
    else:
        row["pricing"]["request"] = "0.001"
    with pytest.raises(router.EvaluationBlocked):
        router.validate_endpoint(candidate, [row], private)


def test_preflight_accepts_only_matching_model_and_endpoint(candidate):
    row = endpoint(candidate)
    assert router.validate_endpoint(candidate, [row], [row])["zdr"] is True
    with pytest.raises(router.EvaluationBlocked):
        router.validate_endpoint(candidate, [row], [{**row, "model_id": "other/model"}])


def test_shared_budget_keeps_uncertain_cost_across_models_days_and_fees(candidate, monkeypatch):
    monkeypatch.setattr(router.time, "time", lambda: 1)
    ledger = [{"at": 0, "groq": True, "amount": 1, "paid": True, "charge_nanousd": 100},
              {"kind": "funding_fee", "paid": True, "charge_nanousd": 800_000_000}]
    router.reserve(ledger, candidate, 1000, 801_000_000)
    monkeypatch.setattr(router.time, "time", lambda: 1000000)
    with pytest.raises(router.EvaluationBlocked, match="evaluation_budget"):
        router.reserve(ledger, router.CANDIDATES["qwen-38"], 1000, 801_000_000)
    assert len(ledger) == 3 and ledger[0]["charge_nanousd"] == 100


@pytest.mark.parametrize("ledger", [{}, [None], [{"paid": True}],
                                     [{"charge_nanousd": -1}], [{"charge_nanousd": True}]])
def test_invalid_ledger_is_never_reset_or_used_to_authorize_spend(ledger, candidate):
    with pytest.raises(router.EvaluationBlocked, match="invalid_ledger"):
        router.reserve(ledger, candidate, 100, 10_000_000_000)


def test_account_requires_dedicated_nonresetting_key_and_keeps_balance_check_explicit():
    data = {"is_free_tier": False, "is_management_key": False, "limit_reset": None,
            "limit": 8, "limit_remaining": 8}
    result = router.validate_account(data, 9_200_000_000)
    assert result["key_limit_nanousd"] == 8_000_000_000
    assert result["balance_check"] == "operator_required"
    for changed in ({"limit": 10}, {"limit_reset": "monthly"}, {"limit_remaining": 0},
                    {"is_management_key": True}, {"is_free_tier": True}):
        with pytest.raises(router.EvaluationBlocked):
            router.validate_account({**data, **changed}, 9_200_000_000)


def test_usage_reconciliation_includes_reasoning_and_retains_unknown_cost(candidate):
    receipt = router.reserve([], candidate, 1000, 10_000_000_000)
    charge = receipt["charge_nanousd"]
    assert router.reconcile(receipt, {"prompt_tokens": 100}) is False
    assert receipt["charge_nanousd"] == charge
    usage = {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
             "completion_tokens_details": {"reasoning_tokens": 40}, "cost": "0.00004"}
    assert router.reconcile(receipt, usage) is True
    assert receipt["amount"] == 150 and receipt["charge_nanousd"] == 40000


@pytest.mark.parametrize("changed", [{"cost": "1"}, {"prompt_tokens": 9999,
                                     "total_tokens": 10049}, {"completion_tokens": 1025,
                                     "total_tokens": 1125}])
def test_usage_exceeding_reservation_stops_evaluation(candidate, changed):
    receipt = router.reserve([], candidate, 1000, 10_000_000_000)
    usage = {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
             "completion_tokens_details": {"reasoning_tokens": 40}, "cost": "0.00004"}
    with pytest.raises(router.EvaluationBlocked, match="usage_exceeded_reservation"):
        router.reconcile(receipt, {**usage, **changed})


def test_request_fixes_route_privacy_price_and_final_citations(candidate, monkeypatch):
    monkeypatch.setattr(settings, "assistant_generation_provider", "groq")
    monkeypatch.setattr(settings, "assistant_mutations_enabled", False)
    messages = [{"role": "system", "content": "Solo evidencia."}]
    body = router.Client.body(candidate, messages, [], structured=True, allowed_source_ids=[])
    assert body["provider"] == {"only": ["fireworks"], "allow_fallbacks": False,
        "require_parameters": True, "data_collection": "deny", "zdr": True,
        "max_price": {"prompt": .15, "completion": .5}}
    assert body["reasoning"] == {"effort": "low", "exclude": True}
    assert body["max_tokens"] == 1024 and body["stream"] is False
    schema = body["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["source_ids"]["maxItems"] == 0
    assert set(schema["properties"]) == {"answer", "source_ids"}
    assert messages[0]["content"] == "Solo evidencia."
    with pytest.raises(router.EvaluationBlocked, match="final_tools_forbidden"):
        router.Client.body(candidate, messages, [{"type": "function"}], structured=True)


def test_transport_never_retries_or_logs_remote_error(candidate, monkeypatch):
    original = httpx.Client
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(429, json={"error": {"message": "private prompt secret"}})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(router.EvaluationBlocked, match="^provider_http_429$"):
        router.Client("test-key").generate(candidate, {}, structured=False)
    assert len(requests) == 1
    assert str(requests[0].url) == router.BASE + "/chat/completions"


def test_decoder_resource_identifiers_match_public_uuid_contract(candidate, monkeypatch):
    monkeypatch.setattr(settings, "assistant_generation_provider", "groq")
    monkeypatch.setattr(settings, "assistant_mutations_enabled", True)
    body = router.Client.body(candidate, [{"role": "system", "content": "Solo evidencia."}],
                              [], structured=True, allowed_source_ids=[])
    schema = body["response_format"]["json_schema"]["schema"]
    resource = schema["properties"]["steps"]["items"]["properties"]["resource_id"]
    assert "null" in resource["type"]
    assert re.fullmatch(resource["pattern"], evaluation.RESOURCE)
    for invalid in ("business", "", "otro-negocio", evaluation.RESOURCE + "-suffix"):
        assert re.fullmatch(resource["pattern"], invalid) is None


@pytest.mark.parametrize("alias", ["qwen-fast", "mistral-small", "mistral-us", "deepseek-fast"])
def test_fast_profile_disables_reasoning_and_rejects_unconfirmed_mode(monkeypatch, alias):
    selected = router.CANDIDATES[alias]
    body = router.Client.body(selected, [{"role": "system", "content": "Solo evidencia."}],
                              [], structured=False)
    assert body["reasoning"] == {"enabled": False, "exclude": True}
    response = {"provider": selected.provider, "choices": [{"finish_reason": "stop",
        "message": {"content": "Sin datos."}}], "usage": {
        "completion_tokens_details": {"reasoning_tokens": 1}}}
    monkeypatch.setattr(router.Client, "request", lambda *args, **kwargs: response)
    with pytest.raises(router.EvaluationBlocked, match="disabled_reasoning_not_verified"):
        router.Client("test-key").generate(selected, body, structured=False)
    response["usage"]["completion_tokens_details"]["reasoning_tokens"] = 0
    assert router.Client("test-key").generate(selected, body, structured=False)["content"]


@pytest.mark.parametrize("alias,reasoning,code", [
    ("qwen-fast", {"mandatory": True}, "reasoning_disable_not_supported"),
    ("glm-flash", {"supported_efforts": ["high", "none"]}, "reasoning_effort_not_supported"),
    ("glm-flash", {}, "reasoning_effort_not_supported"),
])
def test_preflight_rejects_unsupported_reasoning_mode(monkeypatch, alias, reasoning, code):
    selected = router.CANDIDATES[alias]
    row = endpoint(selected)

    def request(self, method, path):
        if path == "/models":
            return {"data": [{"id": selected.model, "reasoning": reasoning}]}
        if path == "/endpoints/zdr":
            return {"data": [row]}
        return {"data": {"endpoints": [row]}}

    monkeypatch.setattr(router.Client, "request", request)
    with pytest.raises(router.EvaluationBlocked, match=code):
        router.Client().preflight(selected)


def test_unexpected_provider_is_rejected(candidate, monkeypatch):
    monkeypatch.setattr(router.Client, "request", lambda *args, **kwargs: {"provider": "Other"})
    with pytest.raises(router.EvaluationBlocked, match="unexpected_provider"):
        router.Client("test-key").generate(candidate, {}, structured=False)


def test_request_progress_does_not_extend_deadline(monkeypatch):
    original = httpx.Client
    times = iter([0, 61])
    monkeypatch.setattr(router.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"ok": True})),
        **kwargs))
    with pytest.raises(router.EvaluationBlocked, match="^provider_response_deadline$"):
        router.Client().request("GET", "/models")


def test_new_inference_requests_are_spaced_without_retry(monkeypatch):
    original = httpx.Client
    clock = [0]
    requested_at = []
    monkeypatch.setattr(router, "MIN_POST_INTERVAL_SECONDS", 2)
    monkeypatch.setattr(router.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(router.time, "sleep", lambda delay: clock.__setitem__(0, clock[0] + delay))

    def handler(request):
        requested_at.append(clock[0])
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    client = router.Client("test-key")
    for _ in range(2):
        client.request("POST", "/chat/completions", {}, authenticated=True)
    assert requested_at == [0, 2]


def test_rate_limit_diagnostics_allow_only_fixed_metadata_and_numeric_headers(monkeypatch):
    original = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(lambda request: httpx.Response(429,
            headers={"Retry-After": "30", "X-RateLimit-Remaining": "0"},
            json={"error": {"message": "private prompt secret", "metadata": {
                "error_type": "rate_limit_exceeded", "provider_name": "Mistral",
                "reason": "private prompt secret", "raw": "private prompt secret"}}})),
        **kwargs))
    with pytest.raises(router.EvaluationBlocked) as raised:
        router.Client().request("GET", "/models")
    assert raised.value.diagnostics == {"retry-after": 30, "x-ratelimit-remaining": 0,
                                       "error_type": "rate_limit_exceeded",
                                       "provider_name": "Mistral"}
    assert "private" not in str(raised.value)


def test_atomic_save_preserves_shared_ledger_symlink(tmp_path):
    shared = tmp_path / "shared.json"
    shared.write_text("[]")
    link = tmp_path / "local.json"
    link.symlink_to(shared)
    comparison.save(link, [{"charge_nanousd": 12}])
    assert link.is_symlink() and json.loads(shared.read_text()) == [{"charge_nanousd": 12}]
    assert shared.stat().st_mode & 0o777 == 0o600


def test_openrouter_receipts_do_not_consume_cloudflare_free_quota(monkeypatch):
    monkeypatch.setattr(evaluation.time, "time", lambda: 100000)
    ledger = [{"at": 99999, "groq": False, "provider": "openrouter", "amount": 999999,
               "paid": True, "charge_nanousd": 1000},
              {"at": 99999, "groq": False, "kind": "funding_fee", "paid": True,
               "charge_nanousd": 800000000}]
    assert evaluation.reserve(ledger, "@cf/qwen/qwen3-30b-a3b-fp8", 100) is not None


def test_comparison_does_not_approve_unreviewed_or_unverified_answers(tmp_path):
    path = tmp_path / "results.json"
    path.write_text(json.dumps([{"model": "glm-flash", "case_id": "analysis-0-0",
        "repetition": 0, "contract_ok": True, "harness_hash": evaluation.harness_hash(),
        "latency_seconds": .5, "calls": [{"usage_verified": False,
        "charge_nanousd": 500, "latency_seconds": .2}], "review": {}}]))
    report = comparison.summary(path, "glm-flash")
    assert report["quality_gate_passed"] is False and report["human_reviewed"] == 0
    assert report["usage_verified"] is False and report["required"] == 660


@pytest.mark.parametrize("seconds,accepted", [(9.9, True), (10, True), (10.01, False)])
def test_quality_approval_also_requires_complete_answer_within_ten_seconds(
    tmp_path, monkeypatch, seconds, accepted
):
    path = tmp_path / "results.json"
    path.write_text(json.dumps([{"model": "qwen-fast", "case_id": "analysis-0-0",
        "repetition": 0, "harness_hash": evaluation.harness_hash(), "latency_seconds": seconds,
        "calls": [{"usage_verified": True, "charge_nanousd": 500, "latency_seconds": 1}]}]))
    # Isolate the new latency prerequisite; this simulated report is not live
    # evidence and does not replace the independent full-corpus/review tests.
    monkeypatch.setattr(evaluation, "summarize", lambda *args: {"quality_gate_passed": True})
    report = comparison.summary(path, "qwen-fast")
    assert report["latency_limit_seconds"] == 10
    assert report["maximum_case_seconds"] == seconds
    assert report["quality_gate_passed"] is accepted


def test_missing_account_verification_makes_zero_calls(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("No provider call authorized")

    monkeypatch.setattr(router.Client, "request", forbidden)
    with pytest.raises(router.EvaluationBlocked, match="verify_dedicated_account"):
        comparison.run(router.Client(), ["glm-flash"], limit=1,
                       budget=router.nanousd(Decimal(10)), funding_fee=0, account_verified=False)


def test_smoke_covers_every_capability_without_changing_corpus():
    corpus = evaluation.cases()
    ordered = comparison.interleaved_cases(corpus)
    capabilities = {case.capability for case in corpus}
    assert {case.capability for case in ordered[:len(capabilities)]} == capabilities
    assert len(ordered) == len(corpus)
    assert {case.id for case in ordered} == {case.id for case in corpus}
    assert all(case is corpus[corpus.index(case)] for case in ordered)


@pytest.mark.parametrize("key_limit", [8, 10])
def test_complete_runner_interleaves_models_and_persists_before_requests(
    tmp_path, monkeypatch, key_limit
):
    monkeypatch.setattr(evaluation, "OUTPUT", tmp_path)
    monkeypatch.setattr(settings, "assistant_enabled", False)
    monkeypatch.setattr(settings, "assistant_documents_enabled", False)
    monkeypatch.setattr(settings, "assistant_email_enabled", False)
    monkeypatch.setattr(settings, "assistant_generation_provider", "cloudflare")
    monkeypatch.setattr(settings, "assistant_mutations_enabled", False)
    original = httpx.Client
    sent = []

    def handler(request):
        if request.url.path == "/api/v1/key":
            return httpx.Response(200, json={"data": {"is_free_tier": False,
                "is_management_key": False, "limit_reset": None, "limit": key_limit,
                "limit_remaining": key_limit}})
        if request.url.path == "/api/v1/models":
            return httpx.Response(200, json={"data": [
                {"id": row.model, "reasoning": {"mandatory": False,
                                                 "supported_efforts": ["low", "none"]}}
                for row in router.CANDIDATES.values()]})
        if request.method == "GET":
            rows = [endpoint(row) for row in router.CANDIDATES.values()]
            # Public endpoint prices must be checked against each candidate's ceiling.
            for row, selected in zip(rows, router.CANDIDATES.values(), strict=True):
                row["pricing"] = {"prompt": str(Decimal(selected.input_nanousd) / 1_000_000_000),
                                  "completion": str(Decimal(selected.output_nanousd)
                                                    / 1_000_000_000)}
            data = rows if request.url.path.endswith("/zdr") else {"endpoints": rows}
            return httpx.Response(200, json={"data": data})
        body = json.loads(request.content)
        selected = next(c for c in router.CANDIDATES.values() if c.model == body["model"])
        ledger = json.loads((tmp_path / "usage-ledger.json").read_text())
        assert ledger[-1]["model"] == selected.model
        assert ledger[-1]["charge_nanousd"] > 0 and ledger[-1]["paid"] is True
        sent.append(selected.model)
        content = "" if "tools" in body else json.dumps({"answer": "Revisa la propuesta.",
            "source_ids": [], "steps": [{"action": "business_profile", "resource_id": None,
                "values": [{"key": "public_name", "value": "Evaluación A"}]}]})
        # The explicit non-thinking profile must receive coherent usage; retain
        # the same total tokens, costs and independent verification assertions.
        reasoning_tokens = 0 if body["reasoning"].get("enabled") is False else 20
        return httpx.Response(200, json={"provider": selected.provider,
            "choices": [{"finish_reason": "stop", "message": {"content": content}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
                "completion_tokens_details": {"reasoning_tokens": reasoning_tokens},
                "cost": "0.00004"}})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    aliases = ["glm-flash", "qwen-38", "mistral-small"]
    report = comparison.run(router.Client("test-key"), aliases, limit=1,
        budget=10_000_000_000, funding_fee=800_000_000, account_verified=True)
    assert sent == [router.CANDIDATES[alias].model for alias in aliases for _ in range(2)]
    assert all(r["completed"] == 1 and not r["quality_gate_passed"] for r in report)
    rows = json.loads((tmp_path / "comparison-results.json").read_text())
    assert all(row["contract_ok"] and row["setup_matches"] for row in rows)
    assert all(all(value is None for value in row["review"].values()) for row in rows)
    ledger = json.loads((tmp_path / "usage-ledger.json").read_text())
    assert sum(r["charge_nanousd"] for r in ledger) == 800_240_000


@pytest.mark.parametrize("interrupted", [False, True])
def test_runner_stops_on_provider_error_and_retains_persisted_reservation(
    tmp_path, monkeypatch, interrupted
):
    monkeypatch.setattr(evaluation, "OUTPUT", tmp_path)
    for name in ("assistant_enabled", "assistant_documents_enabled", "assistant_email_enabled",
                 "assistant_mutations_enabled"):
        monkeypatch.setattr(settings, name, False)
    monkeypatch.setattr(settings, "assistant_generation_provider", "cloudflare")
    monkeypatch.setattr(router.Client, "account", lambda *args: {})
    monkeypatch.setattr(router.Client, "preflight", lambda *args: {})
    original = httpx.Client
    requests = []

    def handler(request):
        requests.append(request)
        assert json.loads((tmp_path / "usage-ledger.json").read_text())[-1]["paid"] is True
        if interrupted:
            raise KeyboardInterrupt
        return httpx.Response(429, json={"error": "synthetic private text"})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    code = "operator_interrupted" if interrupted else "provider_http_429"
    with pytest.raises(router.EvaluationBlocked, match=code):
        comparison.run(router.Client("test-key"), list(router.CANDIDATES), limit=660,
                       budget=10_000_000_000, funding_fee=0, account_verified=True)
    assert len(requests) == 1
    ledger = json.loads((tmp_path / "usage-ledger.json").read_text())
    assert len(ledger) == 1 and ledger[0]["charge_nanousd"] > 0
    rows = json.loads((tmp_path / "comparison-results.json").read_text())
    assert len(rows) == 1 and rows[0]["contract_ok"] is False
    assert rows[0]["calls"][0]["charge_nanousd"] == ledger[0]["charge_nanousd"]
    assert "synthetic private text" not in json.dumps(rows)

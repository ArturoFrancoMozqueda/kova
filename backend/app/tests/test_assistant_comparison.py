import json
from decimal import Decimal

import httpx
import pytest

from app.config import settings
from assistant_evaluation import openrouter as router
from scripts import compare_assistant as comparison
from scripts import evaluate_assistant as evaluation


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


def test_unexpected_provider_is_rejected(candidate, monkeypatch):
    monkeypatch.setattr(router.Client, "request", lambda *args, **kwargs: {"provider": "Other"})
    with pytest.raises(router.EvaluationBlocked, match="unexpected_provider"):
        router.Client("test-key").generate(candidate, {}, structured=False)


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


def test_missing_account_verification_makes_zero_calls(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("No provider call authorized")

    monkeypatch.setattr(router.Client, "request", forbidden)
    with pytest.raises(router.EvaluationBlocked, match="verify_dedicated_account"):
        comparison.run(router.Client(), ["glm-flash"], limit=1,
                       budget=router.nanousd(Decimal(10)), funding_fee=0, account_verified=False)


def test_complete_runner_interleaves_models_and_persists_before_requests(tmp_path, monkeypatch):
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
                "is_management_key": False, "limit_reset": None, "limit": 8,
                "limit_remaining": 8}})
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
        return httpx.Response(200, json={"provider": selected.provider,
            "choices": [{"finish_reason": "stop", "message": {"content": content}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150,
                "completion_tokens_details": {"reasoning_tokens": 20}, "cost": "0.00004"}})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    report = comparison.run(router.Client("test-key"), list(router.CANDIDATES), limit=1,
        budget=10_000_000_000, funding_fee=800_000_000, account_verified=True)
    assert sent == [c.model for c in router.CANDIDATES.values() for _ in range(2)]
    assert all(r["completed"] == 1 and not r["quality_gate_passed"] for r in report)
    rows = json.loads((tmp_path / "comparison-results.json").read_text())
    assert all(row["contract_ok"] and row["setup_matches"] for row in rows)
    assert all(all(value is None for value in row["review"].values()) for row in rows)
    ledger = json.loads((tmp_path / "usage-ledger.json").read_text())
    assert sum(r["charge_nanousd"] for r in ledger) == 800_240_000


def test_runner_stops_on_provider_error_and_retains_persisted_reservation(tmp_path, monkeypatch):
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
        return httpx.Response(429, json={"error": "synthetic private text"})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(router.EvaluationBlocked, match="provider_http_429"):
        comparison.run(router.Client("test-key"), list(router.CANDIDATES), limit=660,
                       budget=10_000_000_000, funding_fee=0, account_verified=True)
    assert len(requests) == 1
    ledger = json.loads((tmp_path / "usage-ledger.json").read_text())
    assert len(ledger) == 1 and ledger[0]["charge_nanousd"] > 0
    rows = json.loads((tmp_path / "comparison-results.json").read_text())
    assert len(rows) == 1 and rows[0]["contract_ok"] is False
    assert rows[0]["calls"][0]["charge_nanousd"] == ledger[0]["charge_nanousd"]
    assert "synthetic private text" not in json.dumps(rows)

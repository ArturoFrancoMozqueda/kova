"""Compare open models on Kova's unchanged synthetic corpus; no production data."""

import argparse
import fcntl
import hashlib
import json
import os
import sys
import tempfile
import time
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from assistant_evaluation.openrouter import (  # noqa: E402
    CANDIDATES,
    Client,
    EvaluationBlocked,
    nanousd,
    reconcile,
    reserve,
    validate_ledger,
)
from scripts import evaluate_assistant as evaluation  # noqa: E402

MAX_CASE_SECONDS = 10  # Operator's maximum acceptable complete-answer wait.


def save(path, value):
    # Resolve the existing shared ledger symlink before an atomic replacement.
    target = path.resolve()
    descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=".evaluation-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def summary(path, alias):
    result = evaluation.summarize(path, alias)
    rows = json.loads(path.read_text()) if path.exists() else []
    rows = [row for row in rows if row["model"] == alias
            and row.get("harness_hash") == evaluation.harness_hash()]
    calls = [call for row in rows for call in row.get("calls", [])]
    maximum = max((row["latency_seconds"] for row in rows), default=None)
    result.update(route=CANDIDATES[alias].route,
                  usage_verified=bool(calls) and all(call["usage_verified"] for call in calls),
                  retained_cost_usd=str(Decimal(sum(call["charge_nanousd"] for call in calls))
                                        / 1_000_000_000),
                  provider_seconds=sum(call["latency_seconds"] for call in calls),
                  maximum_case_seconds=maximum, latency_limit_seconds=MAX_CASE_SECONDS,
                  observed_latency_within_limit=maximum is not None and maximum <= MAX_CASE_SECONDS)
    result["quality_gate_passed"] &= (result["usage_verified"]
                                     and result["observed_latency_within_limit"])
    return result


def interleaved_cases(corpus):
    """Exercise every capability early without changing any case or oracle."""
    groups = {}
    for case in corpus:
        groups.setdefault(case.capability, []).append(case)
    return [group[index] for index in range(max(map(len, groups.values()), default=0))
            for group in groups.values() if index < len(group)]


def run(client, aliases, *, limit, budget, funding_fee, account_verified):
    if not account_verified:
        raise EvaluationBlocked("verify_dedicated_account_and_privacy_first")
    os.environ["APP_ENV"] = "local"
    from app.assistant import provider
    from app.config import settings

    # Reuse identical closed schemas and instructions inside this isolated process.
    # No production adapter/flags, executor, database or customer files are invoked.
    settings.assistant_enabled = False
    settings.assistant_documents_enabled = False
    settings.assistant_email_enabled = False
    settings.assistant_generation_provider = "groq"
    output = evaluation.OUTPUT
    output.mkdir(parents=True, exist_ok=True)
    results_path = output / "comparison-results.json"
    ledger_path = output / "usage-ledger.json"
    with (output / "evaluation.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else []
        validate_ledger(ledger)
        fees = sum(row.get("charge_nanousd", 0) for row in ledger
                   if row.get("kind") == "funding_fee")
        if funding_fee < fees or funding_fee >= budget:
            raise EvaluationBlocked("invalid_funding_fee")
        # The key is capped by the total authorization. The shared ledger reserves
        # funding fees before any POST, so inference cannot spend that portion.
        account = client.account(budget)
        preflight = {alias: client.preflight(CANDIDATES[alias]) for alias in aliases}
        save(output / "comparison-preflight.json", {"checked_at": time.time(),
             "inference_called": False, "account": account, "routes": preflight})
        if funding_fee > fees:
            ledger.append({"kind": "funding_fee", "at": time.time(), "groq": False,
                           "paid": True, "charge_nanousd": funding_fee - fees})
            save(ledger_path, ledger)
        corpus = evaluation.cases()
        digest = hashlib.sha256(json.dumps([asdict(case) for case in corpus],
                                           sort_keys=True).encode()).hexdigest()
        version = evaluation.harness_hash()
        rows = json.loads(results_path.read_text()) if results_path.exists() else []
        completed = {(row["model"], row["case_id"], row["repetition"])
                     for row in rows if row.get("harness_hash") == version
                     and row.get("corpus_hash") == digest}
        counts = dict.fromkeys(aliases, 0)
        # Interleave candidates to avoid exhausting the budget on a single model.
        for repetition in range(3):
            for case in interleaved_cases(corpus):
                for alias in aliases:
                    if counts[alias] >= limit or (alias, case.id, repetition) in completed:
                        continue
                    if evaluation.harness_hash() != version:
                        raise EvaluationBlocked("harness_changed")
                    candidate = CANDIDATES[alias]
                    calls = []

                    def call(messages, tools, *, call_log=calls, selected=candidate, **kwargs):
                        body = client.body(selected, messages, tools,
                                           structured=kwargs["structured"],
                                           allowed_source_ids=kwargs.get("allowed_source_ids"))
                        size = provider.tokens_upper_bound([
                            body["messages"], body.get("tools", []), body.get("response_format")])
                        receipt = reserve(ledger, selected, size, budget)
                        save(ledger_path, ledger)  # Persist before the remote side effect.
                        started = time.monotonic()
                        observation = {"charge_nanousd": receipt["charge_nanousd"],
                                       "usage_verified": False, "latency_seconds": 0}
                        call_log.append(observation)
                        try:
                            response = client.generate(selected, body,
                                                       structured=kwargs["structured"])
                            # This runner uses synthetic cases only. Keep the model's
                            # answer/tool requests so rejected contracts can be reviewed.
                            observation["response"] = {key: response.get(key)
                                                       for key in ("content", "tool_calls")}
                            usage = response.get("usage")
                            verified = reconcile(receipt, usage)
                            save(ledger_path, ledger)
                            observation.update(charge_nanousd=receipt["charge_nanousd"],
                                               usage_verified=verified,
                                               usage={key: usage.get(key) for key in (
                                                   "prompt_tokens", "completion_tokens",
                                                   "total_tokens", "completion_tokens_details",
                                                   "cost")} if isinstance(usage, dict) else None)
                            return response
                        finally:
                            observation["latency_seconds"] = round(time.monotonic() - started, 3)

                    row = {"model": alias, "route": candidate.route, "case_id": case.id,
                           "capability": case.capability, "repetition": repetition,
                           "corpus_hash": digest, "harness_hash": version, "contract_ok": False,
                           "review": dict.fromkeys(("resolution_correct", "citations_relevant",
                                                    "spanish_useful", "safe_behavior"))}
                    started = time.monotonic()
                    blocked = None
                    try:
                        row.update(evaluation.evaluate(case, candidate.model, call),
                                   contract_ok=True)
                    except EvaluationBlocked as exc:
                        blocked = exc
                        row["error_code"] = str(exc)
                        if exc.diagnostics:
                            row["error_diagnostics"] = exc.diagnostics
                    except KeyboardInterrupt:
                        blocked = EvaluationBlocked("operator_interrupted")
                        row["error_code"] = str(blocked)
                    except Exception as exc:
                        # Remote content and validation messages may contain request data.
                        row["error_type"] = type(exc).__name__
                        if type(exc).__name__ == "ValidationError":
                            row["validation_errors"] = [
                                {"type": error["type"], "loc": error["loc"]}
                                for error in exc.errors(include_input=False,
                                                        include_context=False)
                            ]
                    row.update(calls=calls, latency_seconds=round(time.monotonic() - started, 3))
                    rows.append(row)
                    save(results_path, rows)
                    counts[alias] += 1
                    print(f"{alias} {case.id} repetición {repetition + 1}: "
                          f"contrato {'válido' if row['contract_ok'] else 'fallido'}; "
                          "revisión pendiente", flush=True)
                    if blocked:
                        raise blocked
        return [summary(results_path, alias) for alias in aliases]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["all", *CANDIDATES], default="all")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true", help="Solo catálogo público, sin IA")
    mode.add_argument("--summary", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--budget-usd", type=Decimal)
    parser.add_argument("--funding-fee-usd", type=Decimal, default=Decimal(0),
                        help="Comisiones acumuladas reales de recarga; cuentan dentro del máximo")
    parser.add_argument("--account-verified", action="store_true",
                        help="Cuenta dedicada, saldo, key con techo sin reset y logging apagado")
    parser.add_argument("--limit", type=int, default=5, help="Ejecuciones nuevas por candidato")
    args = parser.parse_args()
    aliases = list(CANDIDATES) if args.model == "all" else [args.model]
    try:
        if args.summary:
            result = [summary(evaluation.OUTPUT / "comparison-results.json", alias)
                      for alias in aliases]
        elif args.preflight:
            client = Client()
            result = [client.preflight(CANDIDATES[alias]) for alias in aliases]
            evaluation.OUTPUT.mkdir(parents=True, exist_ok=True)
            save(evaluation.OUTPUT / "comparison-public-preflight.json", result)
        else:
            if (args.budget_usd is None or not args.budget_usd.is_finite()
                    or not 0 < args.budget_usd <= 10 or not 1 <= args.limit <= 660):
                raise EvaluationBlocked("explicit_budget_and_valid_limit_required")
            from dotenv import dotenv_values

            # Dedicated evaluation credential only; never load production .env/config.
            key = os.environ.get("OPENROUTER_EVALUATION_API_KEY") or dotenv_values(
                ROOT / ".env.evaluation.local").get("OPENROUTER_EVALUATION_API_KEY")
            result = run(Client(key), aliases, limit=args.limit,
                         budget=nanousd(args.budget_usd), funding_fee=nanousd(args.funding_fee_usd),
                         account_verified=args.account_verified)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (EvaluationBlocked, BlockingIOError) as exc:
        code = str(exc) if isinstance(exc, EvaluationBlocked) else "evaluation_already_running"
        raise SystemExit(f"Evaluación detenida: {code}. No se aprueba ningún modelo.") from None


if __name__ == "__main__":
    main()

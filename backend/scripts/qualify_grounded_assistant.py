"""Evaluate the selected read-only architecture, not arbitrary model prose.

Preserves all original cases/oracles; configuration remains outside this launch scope.
Shares the existing ten-dollar ledger, privacy policy, lock and uncertain reservations.
Synthetic retrieval is not parser/RLS/load/browser QA and cannot grant activation.
"""

import argparse
import asyncio
import fcntl
import hashlib
import json
import os
import sys
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from dotenv import dotenv_values
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["APP_ENV"] = "local"

from app.assistant import deadline, generation, grounding, openrouter, provider, tools  # noqa: E402
from app.assistant.schemas import Answer  # noqa: E402
from app.config import settings  # noqa: E402
from assistant_evaluation.openrouter import (  # noqa: E402
    Candidate,
    Client,
    EvaluationBlocked,
    nanousd,
    reconcile,
    reserve,
    validate_ledger,
)
from scripts import evaluate_assistant as evaluation  # noqa: E402
from scripts.compare_assistant import interleaved_cases, save  # noqa: E402

OUTPUT = evaluation.OUTPUT / "grounded-final"
CANDIDATE = Candidate(
    openrouter.MODEL,
    openrouter.ROUTE,
    openrouter.RECIPIENT,
    openrouter.INPUT_NANOUSD,
    openrouter.OUTPUT_NANOUSD,
    reasoning_enabled=False,
)
FILES = (
    "scripts/qualify_grounded_assistant.py",
    "scripts/evaluate_assistant.py",
    "scripts/compare_assistant.py",
    "assistant_evaluation/cases.py",
    "assistant_evaluation/openrouter.py",
    "app/assistant/generation.py",
    "app/assistant/grounding.py",
    "app/assistant/openrouter.py",
    "app/assistant/deadline.py",
    "app/assistant/tools.py",
    "app/assistant/provider.py",
    "app/assistant/router.py",
    "app/assistant/schemas.py",
    "app/assistant/knowledge.py",
    "app/assistant/openrouter_budget.py",
    "app/assistant/budget.py",
    "app/assistant/worker.py",
    "app/assistant/direct.py",
    "app/reports/service.py", "app/reports/repository.py",
    "app/config.py",
    "scripts/run_assistant_worker.py",
    "scripts/run_assistant_ingest.py",
    "app/assistant/documents.py",
    "assistant-parser/parse.py",
    "assistant-parser/Dockerfile",
    "Dockerfile",
    "fly.toml",
)


def version():
    digest = hashlib.sha256()
    # A different recipient is a different qualification, even with the same code.
    digest.update(json.dumps(asdict(CANDIDATE), sort_keys=True).encode())
    for relative in FILES:
        digest.update(relative.encode())
        digest.update((ROOT / relative).read_bytes())
    return digest.hexdigest()


def evaluate(case, call):
    config = evaluation.synthetic_result("get_configuration", case)
    messages = [
        {"role": "system", "content": generation.system_prompt()},
        {"role": "user", "content": case.prompt},
    ]
    planning = call(
        [
            {
                "role": "system",
                "content": generation.planning_system_prompt()
                + "\nConfiguración real, evidencia: "
                + json.dumps(config),
            },
            *messages[1:],
        ],
        provider.planning_tools(tools.TOOLS),
        structured=False,
    )
    selected = generation.ensure_document_read(case.prompt, planning["tool_calls"])
    if len(selected) > 8:
        raise EvaluationBlocked("too_many_tools")
    names, readings = [], []
    for i, item in enumerate(selected):
        function = item.get("function", item)
        name = function["name"]
        if name not in tools.SCHEMAS:
            raise EvaluationBlocked("unauthorized_tool")
        arguments = function.get("arguments", {})
        if isinstance(arguments, str):
            arguments = json.loads(arguments)
        tools.SCHEMAS[name].model_validate(arguments)
        readings.append({"name": name, "arguments": arguments})
        result = evaluation.synthetic_result(name, case)
        if name == "search_knowledge":
            result = generation.bounded_sources(result)
        messages.extend(
            [
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": str(i),
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": str(i), "content": json.dumps(result)},
            ]
        )
        names.append(name)
    sources = grounding.sources(messages)
    report = grounding.report_answer(messages)
    if grounding.useful_passages(messages):
        final = call(
            grounding.extraction_messages(messages),
            [],
            structured=True,
            allowed_source_ids=sorted({source["id"] for source in sources}),
        )
        answer = Answer.model_validate_json(final["content"])
        grounding.validate_selected_answer(answer, grounding.extraction_messages(messages))
        if report:
            answer.answer = report + "\n\n" + answer.answer
    else:
        answer = Answer(answer=report or grounding.fallback_answer(messages))
    if answer.steps:
        raise EvaluationBlocked("invalid_answer_contract")
    return {
        "answer": answer.model_dump(mode="json"),
        "tools": names,
        "readings": readings,
        "has_required_citation": bool(answer.source_ids)
        if case.guide or case.private_sources
        else None,
        "setup_matches": None,
    }


def run(client, limit, *, case_spacing=3):
    settings.assistant_generation_provider = "openrouter"
    settings.assistant_mutations_enabled = False
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ledger_path = evaluation.OUTPUT / "usage-ledger.json"
    results_path = OUTPUT / "results.json"
    with (evaluation.OUTPUT / "evaluation.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not ledger_path.exists():
            raise EvaluationBlocked("existing_shared_ledger_required")
        ledger = json.loads(ledger_path.read_text())
        validate_ledger(ledger)
        fees = sum(
            row.get("charge_nanousd", 0) for row in ledger if row.get("kind") == "funding_fee"
        )
        if fees != nanousd("0.80"):
            raise EvaluationBlocked("funding_fee_mismatch")
        account = client.account(nanousd(10))
        preflight = (
            [client.preflight(Candidate(openrouter.MODEL, route, recipient,
                                       CANDIDATE.input_nanousd, CANDIDATE.output_nanousd))
             for route, recipient in zip(openrouter.ROUTES, openrouter.RECIPIENTS, strict=True)]
            if len(openrouter.ROUTES) > 1 else client.preflight(CANDIDATE)
        )
        all_cases = evaluation.cases()
        corpus = [case for case in all_cases if case.capability != "configuration"]
        digest = hashlib.sha256(
            json.dumps([asdict(case) for case in all_cases], sort_keys=True).encode()
        ).hexdigest()
        source_version = version()
        save(
            OUTPUT / "manifest.json",
            {
                "harness_hash": source_version,
                "runtime_profile_hash": openrouter.profile_hash(),
                "corpus_hash": digest,
                "profile": asdict(CANDIDATE),
                "all_original_cases": len(all_cases),
                "read_only_cases": len(corpus),
                "required": len(corpus) * 3,
                "excluded_capability": "configuration",
                "original_oracles_unchanged": True,
                "answer_contract": "server_copied_document_numbers_verified_verbatim",
                "budget_usd": 10,
                "funding_fee_usd": "0.80",
                "account": account,
                "preflight": preflight,
                "human_review_required": True,
                "case_spacing_seconds": case_spacing,
                "sampling": "serial_quality_evaluation_not_load_test",
                "e2e_verified": False,
            },
        )
        rows = json.loads(results_path.read_text()) if results_path.exists() else []
        seen = {
            (r["case_id"], r["repetition"])
            for r in rows
            if r["harness_hash"] == source_version and r["corpus_hash"] == digest
        }
        executed = 0
        for repetition in range(3):
            for case in interleaved_cases(corpus):
                if executed >= limit or (case.id, repetition) in seen:
                    continue
                if version() != source_version:
                    raise EvaluationBlocked("harness_changed")
                calls = []

                def call(
                    messages, available, *, structured, allowed_source_ids=None, call_log=calls
                ):
                    body = openrouter.body(
                        messages,
                        available,
                        structured=structured,
                        allowed_source_ids=allowed_source_ids,
                    )
                    size = provider.tokens_upper_bound(
                        [body["messages"], body.get("tools", []), body.get("response_format")]
                    )
                    if client._last_inference_started is not None:
                        delay = client._last_inference_started + 2 - time.monotonic()
                        if delay > 0:
                            time.sleep(delay)
                    deadline.remaining()
                    client._last_inference_started = time.monotonic()
                    receipt = reserve(ledger, CANDIDATE, size, nanousd(10))
                    save(ledger_path, ledger)
                    try:
                        result = asyncio.run(
                            openrouter.request(
                                openrouter.BASE + "/chat/completions",
                                body,
                                "Bearer " + client.api_key,
                            )
                        )
                        decoded = openrouter.decode(result, messages, structured=structured)
                        verified = reconcile(receipt, result.get("usage"))
                        call_log.append(
                            {
                                "recipient": result.get("provider"),
                                "usage_verified": verified,
                                "charge_nanousd": receipt["charge_nanousd"],
                            }
                        )
                        return decoded
                    finally:
                        save(ledger_path, ledger)

                # Space consultations outside the interactive measurement. The
                # quality battery must not masquerade as production load testing.
                if executed:
                    time.sleep(case_spacing)
                started = time.monotonic()
                row = {
                    "model": CANDIDATE.model + "@" + CANDIDATE.route,
                    "case_id": case.id,
                    "capability": case.capability,
                    "repetition": repetition,
                    "harness_hash": source_version,
                    "corpus_hash": digest,
                    "calls": calls,
                    "review": dict.fromkeys(
                        (
                            "resolution_correct",
                            "citations_relevant",
                            "spanish_useful",
                            "safe_behavior",
                        )
                    ),
                    "contract_ok": False,
                }
                error = None
                try:
                    with deadline.scope(SimpleNamespace(created_at=datetime.now(UTC))):
                        row.update(evaluate(case, call))
                        deadline.remaining()
                        row["contract_ok"] = True
                except (EvaluationBlocked, HTTPException, ValueError, KeyError, TypeError) as exc:
                    error = (
                        str(exc)
                        if isinstance(exc, EvaluationBlocked)
                        else (
                            (exc.headers or {}).get(
                                "X-Kova-Assistant-Provider-Error", "http_" + str(exc.status_code)
                            )
                            if isinstance(exc, HTTPException)
                            else type(exc).__name__
                        )
                    )
                    row["error"] = error
                row["latency_seconds"] = round(time.monotonic() - started, 3)
                rows.append(row)
                save(results_path, rows)
                executed += 1
                print(
                    json.dumps(
                        {
                            "case": case.id,
                            "repetition": repetition,
                            "seconds": row["latency_seconds"],
                            "error": error,
                        }
                    ),
                    flush=True,
                )
                if error:
                    raise EvaluationBlocked(error)
        return {
            "new_executions": executed,
            "required": len(corpus) * 3,
            "activation_approved": False,
            "note": "Faltan revisión humana y QA E2E.",
        }


def main():
    global CANDIDATE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--account-verified", action="store_true")
    parser.add_argument("--limit", type=int, default=18)
    parser.add_argument("--case-spacing", type=int, choices=range(0, 61), default=3)
    args = parser.parse_args()
    if not args.run or not args.account_verified or not 1 <= args.limit <= 540:
        raise SystemExit(
            "Usa --run --account-verified y un límite entre uno y quinientos cuarenta."
        )
    key = dotenv_values(ROOT / ".env.evaluation.local").get("OPENROUTER_EVALUATION_API_KEY")
    CANDIDATE = Candidate(openrouter.MODEL, openrouter.ROUTE, openrouter.RECIPIENT,
                          openrouter.INPUT_NANOUSD, openrouter.OUTPUT_NANOUSD,
                          reasoning_enabled=False)
    try:
        print(json.dumps(run(Client(key), args.limit, case_spacing=args.case_spacing),
                         ensure_ascii=False))
    except (EvaluationBlocked, BlockingIOError) as exc:
        print(
            "Evaluación detenida: "
            + (str(exc) if isinstance(exc, EvaluationBlocked) else "evaluation_already_running")
            + ". Sin aprobación.",
            flush=True,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

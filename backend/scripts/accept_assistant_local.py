"""Disposable HTTP/browser/load acceptance. No hosted DB, provider key or inference.

Runs the real API and three real chat workers against forced-RLS PostgreSQL.
All accounts, trials, sales and sessions are created through the normal API.
This report cannot qualify a model or approve production activation.
"""

import argparse
import hashlib
import json
import math
import os
import secrets
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[2]
PYTHON = ROOT / "backend/.venv/bin/python"
PASSWORD = "Kova-Acceptance-Only-2026!"
IMAGE = "pgvector/pgvector:0.8.7-pg16-bookworm"


def source_hash():
    digest = hashlib.sha256()
    for path in sorted([* (ROOT / "backend/app").rglob("*.py"),
                        * (ROOT / "frontend/src").rglob("*.tsx"),
                        * (ROOT / "frontend/src").rglob("*.ts"), Path(__file__),
                        ROOT / "frontend/e2e/assistant-real.spec.ts"]):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def execute(args, *, cwd=None, env=None, stdin=None, log=None):
    result = subprocess.run(args, cwd=cwd, env=env, input=stdin, text=True,
                            stdout=log or subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=180, check=False)
    if result.returncode:
        raise RuntimeError("acceptance_subprocess_failed:" + Path(args[0]).name)
    return result.stdout


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def start(stack, args, env, cwd, log):
    process = subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    stack.callback(stop, process)
    return process


def wait_http(url, process):
    with httpx.Client(trust_env=False, timeout=1) as probe:
        for _ in range(300):
            if process.poll() is not None:
                raise RuntimeError("acceptance_server_exited")
            try:
                if probe.get(url).status_code == 200:
                    return
            except httpx.RequestError:
                pass
            time.sleep(.1)
    raise RuntimeError("acceptance_server_unavailable")


def write(client, path, body=None, *, key=None):
    # Only synthetic local sessions are used; never print or persist cookies.
    csrf = client.cookies.get("csrf_token")
    response = client.post(path, json=body, headers={
        "X-CSRF-Token": csrf or "", "Idempotency-Key": key or str(uuid4()),
    })
    if response.status_code not in {200, 201, 202}:
        raise RuntimeError(f"acceptance_write_failed:{path}:{response.status_code}")
    return response.json()


def preferences(client, enabled):
    current = client.get("/api/v1/assistant/preferences").json()
    response = client.put("/api/v1/assistant/preferences", json={
        **current, "chat_consent": enabled,
    }, headers={"X-CSRF-Token": client.cookies.get("csrf_token") or ""})
    if response.status_code != 200:
        raise RuntimeError("acceptance_consent_failed")


def enqueue(actor, question="¿Cuánto vendí hoy?", key=None, conversation=None):
    client = actor["client"]
    conversation = conversation or write(client, "/api/v1/assistant/conversations", {})["id"]
    key = key or str(uuid4())
    path = f"/api/v1/assistant/conversations/{conversation}/messages"
    run = write(client, path, {"content": question}, key=key)
    return conversation, run, key


def turn(actor):
    started = time.monotonic()
    conversation, run, key = enqueue(actor)
    replay = write(actor["client"], f"/api/v1/assistant/conversations/{conversation}/messages",
                   {"content": "¿Cuánto vendí hoy?"}, key=key)
    if replay["id"] != run["id"]:
        raise RuntimeError("acceptance_replay_created_another_run")
    while time.monotonic() - started < 15:
        response = actor["client"].get(f"/api/v1/assistant/runs/{run['id']}")
        if response.status_code != 200:
            raise RuntimeError("acceptance_run_read_failed")
        result = response.json()
        if result["status"] not in {"queued", "running"}:
            history = actor["client"].get(
                f"/api/v1/assistant/conversations/{conversation}",
            ).json()["messages"]
            answers = [row for row in history if row["data"].get("run_id") == run["id"]]
            correct = (result["status"] == "completed" and len(answers) == 1
                       and result["data"].get("metrics", {}).get("net_sales") == actor["net_sales"]
                       and result["data"].get("response_mode") == "direct"
                       and answers[0]["data"]["metrics"] == result["data"]["metrics"])
            return {"correct": correct, "status": result["status"],
                    "seconds": round(time.monotonic() - started, 4), "run_id": run["id"]}
        time.sleep(.1)
    return {"correct": False, "status": "timeout", "seconds": 15, "run_id": run["id"]}


def distribution(values):
    ordered = sorted(values)
    return {"count": len(ordered), "p50_ms": round(ordered[math.ceil(len(ordered) * .5)-1], 2),
            "p95_ms": round(ordered[math.ceil(len(ordered) * .95)-1], 2),
            "max_ms": round(max(ordered), 2)} if ordered else {"count": 0}


def run(*, browser=False, provider_name="cloudflare"):
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    output = ROOT / "output/assistant-acceptance" / stamp
    output.mkdir(parents=True)
    report = {"started_at": stamp, "runtime": "local_native_api_and_three_chat_workers",
              "provider": provider_name,
              "source_hash": source_hash(),
              "provider_calls": 0, "real_inference_verified": False, "activation_approved": False,
              "cloudflare_load_verified": False, "browser_verified": False, "passed": False}

    def checkpoint(stage):
        report["stage"] = stage
        (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))

    checkpoint("starting")
    with ExitStack() as stack:
        scratch = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="kova-assistant-")))
        log = stack.enter_context((output / "runtime.log").open("w"))
        name = "kova-assistant-acceptance-" + uuid4().hex[:10]
        execute(["docker", "run", "-d", "--name", name, "-e", "POSTGRES_USER=pos",
                 "-e", "POSTGRES_PASSWORD=pos", "-e", "POSTGRES_DB=assistant_acceptance",
                 "-p", "127.0.0.1::5432", IMAGE], log=log)
        stack.callback(execute, ["docker", "rm", "-f", name])
        binding = execute(["docker", "port", name, "5432/tcp"]).strip()
        db_port = int(binding.rsplit(":", 1)[1])
        api_port, web_port = port(), port()
        api_url, web_url = f"http://127.0.0.1:{api_port}", f"http://127.0.0.1:{web_port}"
        # Deliberately do not inherit credentials, endpoints or production configuration.
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
        env.update(APP_ENV="local", PYTHONPATH=str(ROOT / "backend"),
                   SECRET_KEY=secrets.token_urlsafe(48),
                   DATABASE_URL=f"postgresql+psycopg://pos:pos@127.0.0.1:{db_port}/assistant_acceptance",
                   MIGRATION_DATABASE_URL=f"postgresql+psycopg://pos:pos@127.0.0.1:{db_port}/assistant_acceptance",
                   APP_DATABASE_URL=f"postgresql+psycopg://kova_app:acceptance_only@127.0.0.1:{db_port}/assistant_acceptance",
                   FRONTEND_URL=web_url, ASSISTANT_ENABLED="true",
                   ASSISTANT_GENERATION_PROVIDER=provider_name, ASSISTANT_DOCUMENTS_ENABLED="false",
                   ASSISTANT_MUTATIONS_ENABLED="false", ASSISTANT_EMAIL_ENABLED="false")
        for _ in range(100):
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "pos"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
            if ready == 0:
                break
            time.sleep(.1)
        config = (ROOT / "backend/alembic.ini").read_text().replace(
            "script_location = alembic", f"script_location = {ROOT / 'backend/alembic'}",
        ).replace("prepend_sys_path = .", f"prepend_sys_path = {ROOT / 'backend'}")
        (scratch / "alembic.ini").write_text(config)
        execute([str(PYTHON), "-m", "alembic", "-c", str(scratch / "alembic.ini"),
                 "upgrade", "head"], cwd=scratch, env=env, log=log)
        execute(["docker", "exec", "-i", name, "psql", "-U", "pos", "-d", "assistant_acceptance",
                 "-v", "kova_app_password=acceptance_only", "-f", "-"],
                stdin=(ROOT / "backend/scripts/provision_app_role.sql").read_text(), log=log)
        execute([str(PYTHON), "-c", (
            "from app.db import assert_rls_active; "
            "from app.assistant.access import assert_private_policies; "
            "catalog = assert_rls_active(); assert_private_policies(policy_catalog=catalog)"
        )], cwd=scratch, env={**env, "APP_ENV": "production"}, log=log)
        report["rls_verified"] = True
        checkpoint("rls_ready")
        api_args = [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
                    "--port", str(api_port), "--no-access-log"]
        server = start(stack, api_args, env, scratch, log)
        wait_http(api_url + "/health/db", server)
        actors = []
        for index in range(9):
            client = stack.enter_context(httpx.Client(base_url=api_url, timeout=20, trust_env=False,
                # Bootstrap restarts the API after fixing its cohort. Keep
                # sessions but no idle TCP connection across that restart;
                # never retry an ambiguous write to make the fixture pass.
                limits=httpx.Limits(max_keepalive_connections=0), headers={"Origin": web_url}))
            email = f"assistant-acceptance-{stamp}-{index}@example.com"
            created = write(client, "/api/v1/auth/signup", {
                "email": email, "password": PASSWORD,
                "tenant_name": f"Aceptación asistente {index}",
                "accepted_terms": True,
            })
            write(client, "/api/v1/auth/verify", {"token": created["dev_verification_token"]})
            write(client, "/api/v1/auth/login", {"email": email, "password": PASSWORD})
            amount = Decimal("37.50") + index
            product = write(client, "/api/v1/catalog/products", {
                "name": f"Producto de aceptación {index}", "price_amount": str(amount),
            })
            write(client, "/api/v1/orders", {
                "items": [{"product_id": product["id"], "quantity": 2}],
                "payments": [{"method": "manual_card", "amount": str(amount * 2)}],
            })
            actors.append({"client": client, "email": email, "tenant_id": created["tenant_id"],
                           "net_sales": str(amount * 2)})
        stop(server)
        env["ASSISTANT_TENANT_IDS"] = ",".join(actor["tenant_id"] for actor in actors[:8])
        server = start(stack, api_args, env, scratch, log)
        wait_http(api_url + "/health/db", server)
        for actor in actors[:8]:
            caps = actor["client"].get("/api/v1/assistant/capabilities").json()
            if not caps["enabled"] or caps["inference_ready"]:
                raise RuntimeError("acceptance_unexpected_capabilities")
            preferences(actor["client"], True)
        checkpoint("fixtures_ready")
        worker_args = [str(PYTHON), str(ROOT / "backend/scripts/run_assistant_worker.py"),
                       "--workload", "chat"]
        with ThreadPoolExecutor(max_workers=8) as pool:
            cold = pool.submit(turn, actors[6])
            workers = [start(stack, worker_args, env, scratch, log) for _ in range(3)]
            report["cold_turn"] = {key: value for key, value in cold.result().items()
                                   if key != "run_id"}
            baseline = []
            for _ in range(5):
                started = time.monotonic()
                response = actors[0]["client"].get("/api/v1/catalog/products")
                if response.status_code != 200:
                    raise RuntimeError("acceptance_pos_baseline_failed")
                baseline.append((time.monotonic() - started) * 1000)
            load, canary = [], []
            for _ in range(2):
                futures = [pool.submit(turn, actor) for actor in actors[:6]]
                while not all(future.done() for future in futures):
                    started = time.monotonic()
                    response = actors[7]["client"].get("/api/v1/catalog/products")
                    canary.append({"status": response.status_code,
                                   "ms": (time.monotonic() - started) * 1000})
                    time.sleep(.1)
                load.extend(future.result() for future in futures)
        report.update(load={"actors": 6, "rounds": 2, "turns": len(load),
                            "correct": sum(row["correct"] for row in load),
                            "latency": distribution([row["seconds"] * 1000 for row in load])},
                      pos_baseline=distribution(baseline),
                      pos_during_load={**distribution([row["ms"] for row in canary]),
                                       "errors": sum(row["status"] != 200 for row in canary)})
        checkpoint("load_complete")
        for process in workers:
            stop(process)
        conversation, overdue, _ = enqueue(actors[0])
        active = actors[0]["client"].post(
            f"/api/v1/assistant/conversations/{conversation}/messages",
            json={"content": "¿Cuánto vendí ayer?"},
            headers={"X-CSRF-Token": actors[0]["client"].cookies.get("csrf_token") or "",
                     "Idempotency-Key": str(uuid4())},
        )
        _, cancelled, _ = enqueue(actors[1])
        cancel = write(actors[1]["client"], f"/api/v1/assistant/runs/{cancelled['id']}/cancel")
        time.sleep(10.2)
        expired = actors[0]["client"].get(f"/api/v1/assistant/runs/{overdue['id']}").json()
        foreign = actors[2]["client"].get(f"/api/v1/assistant/runs/{load[0]['run_id']}")
        conflict = actors[2]["client"].get("/api/v1/assistant/capabilities", headers={
            "X-Kova-Expected-Tenant": actors[0]["tenant_id"],
        })
        no_csrf = actors[2]["client"].post("/api/v1/assistant/conversations", json={})
        preferences(actors[5]["client"], False)
        c = write(actors[5]["client"], "/api/v1/assistant/conversations", {})
        revoked = actors[5]["client"].post(f"/api/v1/assistant/conversations/{c['id']}/messages",
            json={"content": "¿Cuánto vendí hoy?"}, headers={
                "X-CSRF-Token": actors[5]["client"].cookies.get("csrf_token") or "",
                "Idempotency-Key": str(uuid4()),
            })
        excluded = actors[8]["client"].get("/api/v1/assistant/capabilities").json()
        report["controls"] = {"active_turn_rejected": active.status_code == 429,
                              "cancelled": cancel["status"] == "cancelled",
                              "missed_wake_expires": expired["status"] == "failed",
                              "foreign_run_denied": foreign.status_code == 404,
                              "tenant_conflict_denied": conflict.status_code == 409,
                              "csrf_required": no_csrf.status_code == 403,
                              "consent_revoked": revoked.status_code == 403,
                              "excluded_cohort": excluded["enabled"] is False}
        for _ in range(3):
            start(stack, worker_args, env, scratch, log)
        report["local_api_load_passed"] = (
            report["cold_turn"]["correct"] and all(row["correct"] for row in load)
            and report["cold_turn"]["seconds"] <= 10
            and report["load"]["latency"]["max_ms"] <= 10000
            and report["pos_during_load"]["errors"] == 0
            and all(report["controls"].values())
        )
        checkpoint("controls_complete")
        if browser:
            checkpoint("browser_running")
            fixtures = [{key: actor[key] for key in ("email", "net_sales", "tenant_id")}
                        for actor in actors[6:8]]
            fixture_path = scratch / "actors.json"
            fixture_path.write_text(json.dumps(fixtures))
            metrics_path = scratch / "browser-metrics.jsonl"
            web_env = {**env, "VITE_API_BASE_URL": api_url, "PLAYWRIGHT_BASE_URL": web_url,
                       "KOVA_INTEGRATION": "1",
                       "KOVA_ASSISTANT_ACCEPTANCE_FIXTURE": str(fixture_path),
                       "KOVA_ASSISTANT_ACCEPTANCE_METRICS": str(metrics_path)}
            execute(["npm", "run", "build"], cwd=ROOT / "frontend", env=web_env, log=log)
            frontend = start(stack, ["npm", "run", "preview", "--", "--host", "127.0.0.1",
                                     "--port", str(web_port), "--strictPort"],
                             web_env, ROOT / "frontend", log)
            wait_http(web_url + "/login", frontend)
            execute(["npx", "playwright", "test", "e2e/assistant-real.spec.ts",
                     "--project=chromium",
                     "--workers=1"], cwd=ROOT / "frontend", env=web_env, log=log)
            report["browser_verified"] = True
            report["browser_metrics"] = [json.loads(line)
                                         for line in metrics_path.read_text().splitlines()]
        report["source_unchanged"] = source_hash() == report["source_hash"]
        report["passed"] = report["local_api_load_passed"] and report["source_unchanged"]
        report["completed_at"] = datetime.now(UTC).isoformat()
        checkpoint("complete")
    return output / "report.json", report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--provider", choices=("cloudflare", "openrouter"), default="cloudflare")
    args = parser.parse_args()
    try:
        path, report = run(browser=args.browser, provider_name=args.provider)
    except (RuntimeError, httpx.HTTPError, subprocess.TimeoutExpired, KeyError) as exc:
        # HTTP errors and runtime logs may contain request state; print only a fixed category.
        print(json.dumps({"passed": False, "error": type(exc).__name__}))
        raise SystemExit(1) from None
    print(json.dumps({"report": str(path), **report}, ensure_ascii=False))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()

"""Exercise real Sentry patches in a fresh process, never send telemetry externally."""

import os
import subprocess
import sys
from pathlib import Path
from textwrap import dedent


def test_resident_health_survives_monitor_traffic_and_still_captures_errors(tmp_path):
    script = dedent('''
        import json
        import sentry_sdk
        from fastapi import APIRouter, Depends, FastAPI, HTTPException
        from fastapi.testclient import TestClient
        from sentry_sdk.transport import Transport

        events = []
        class MemoryTransport(Transport):
            def capture_envelope(self, envelope):
                for item in envelope.items:
                    event = item.get_event()
                    if event is not None:
                        events.append(event)

        real_init = sentry_sdk.init
        def memory_init(**kwargs):
            return real_init(**kwargs, transport=MemoryTransport)
        sentry_sdk.init = memory_init

        from app.observability.sentry import init_sentry
        init_sentry()
        from app.health.router import router
        from app.native_checks import prepare_native_routes

        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        app.include_router(router)
        protected = APIRouter(prefix="/protected")
        def require_session():
            raise HTTPException(status_code=401, detail="Authentication required")
        @protected.get("", dependencies=[Depends(require_session)])
        def guarded():
            raise AssertionError("Unauthorized endpoint executed")
        @protected.get("/failure")
        def failure():
            raise RuntimeError("private-customer-canary")
        app.include_router(protected)
        prepare_native_routes(app)

        with TestClient(app, raise_server_exceptions=False) as client:
            # One resident process, > Python's recursion limit on each health
            # route. SDK 2.59 accumulates wrappers and fails at about request 993.
            for index in range(1100):
                response = client.head("/health")
                assert response.status_code == 200, (index, response.status_code)
                assert response.content == b""
                response = client.get("/health")
                assert response.status_code == 200, (index, response.status_code)
                assert response.json()["release_sha"] == "a" * 40
            for method in (client.get, client.head):
                response = method("/health/db")
                assert response.status_code == 200
            for _ in range(3):
                assert client.get("/protected").status_code == 401
            assert client.get("/protected/failure").status_code == 500

        sentry_sdk.flush(timeout=2)
        errors = [event for event in events if event.get("exception")]
        assert errors, "Sentry stopped capturing real application exceptions"
        assert any(event["release"] == "a" * 40 for event in errors)
        assert "private-customer-canary" not in json.dumps(errors)
        print("resident_sentry_regression_pass")
    ''')
    backend = Path(__file__).resolve().parents[2]
    environment = dict(os.environ)
    environment.update(
        PYTHONPATH=str(backend),
        SENTRY_DSN="https://synthetic-public@sentry.invalid/1",
        KOVA_RELEASE_SHA="a" * 40,
        GIT_SHA="b" * 40,
    )
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=tmp_path, env=environment,
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "resident_sentry_regression_pass" in result.stdout

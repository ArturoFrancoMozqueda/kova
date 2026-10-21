"""Real uvicorn transport preserves HTTPS redirects and auth-cookie headers.

The temporary probe exists only in this test process. It exercises Kova's real
cookie helper without creating an account, session or production database row.
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


def test_native_private_proxy_preserves_https_redirect_and_secure_cookies(tmp_path):
    backend = Path(__file__).resolve().parents[2]
    (tmp_path / "native_proxy_probe.py").write_text(
        "from fastapi import Request\n"
        "from fastapi.responses import JSONResponse\n"
        "from app.main import app as inner\n"
        "from app.auth.router import _set_auth_cookies\n"
        "from app.config import settings\n"
        "from app.native import app\n"
        "# Isolate cookie policy from boot guards: boot in local test mode;\n"
        "# then exercise the same secure-cookie policy as production.\n"
        "settings.app_env = 'production'\n"
        "@inner.get('/_native_proxy_probe/')\n"
        "def probe(request: Request):\n"
        "    response = JSONResponse({'scheme': request.url.scheme})\n"
        "    _set_auth_cookies(response, 'synthetic-access', 'synthetic-refresh')\n"
        "    return response\n",
        encoding="utf-8",
    )
    # An explicit allowlist and an empty working directory prevent loading any
    # operator .env or live credentials into this isolated local subprocess.
    env = {name: os.environ[name] for name in ("PATH", "LANG", "TMPDIR") if name in os.environ}
    env.update({
        "APP_ENV": "local",
        "CLOUDFLARE_CONTAINER_MODE": "true",
        "KOVA_IMAGE_SHA": "a" * 40,
        "KOVA_RELEASE_SHA": "a" * 40,
        "DATABASE_URL": "postgresql+psycopg://synthetic@127.0.0.1:1/unused",
        "APP_DATABASE_URL": "postgresql+psycopg://synthetic@127.0.0.1:1/unused",
        "MIGRATION_DATABASE_URL": "postgresql+psycopg://synthetic@127.0.0.1:1/unused",
        "ASSISTANT_DOCUMENTS_ENABLED": "false",
        "ASSISTANT_INGEST_ON_DEMAND": "false",
        "PYTHONPATH": str(backend),
    })
    with socket.socket() as listener, (tmp_path / "uvicorn.log").open("w") as log:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "native_proxy_probe:app", "--fd",
             str(listener.fileno()), "--proxy-headers", "--forwarded-allow-ips", "*",
             "--no-access-log"],
            cwd=tmp_path, env=env, stdout=log, stderr=log,
            pass_fds=(listener.fileno(),),
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False) as client:
                for _ in range(100):
                    assert process.poll() is None, "Native probe exited before readiness"
                    try:
                        if client.get("/health", timeout=0.2).status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.05)
                else:
                    raise AssertionError("Native probe did not become ready")
                headers = {"Host": "api.example.test", "X-Forwarded-Proto": "https"}
                redirect = client.get("/_native_proxy_probe", headers=headers)
                assert redirect.status_code == 307
                assert redirect.headers["location"] == "https://api.example.test/_native_proxy_probe/"
                response = client.get("/_native_proxy_probe/", headers=headers)
                assert response.json() == {"scheme": "https"}
                cookies = response.headers.get_list("set-cookie")
                assert len(cookies) == 3
                assert all("Secure" in cookie and "SameSite=lax" in cookie for cookie in cookies)
                assert all("HttpOnly" in cookie for cookie in cookies[:2])
                assert "HttpOnly" not in cookies[2]  # CSRF cookie stays readable by the SPA.
                assert response.headers["x-kova-runtime"] == "native-resident"
                assert response.headers["x-kova-process-id"] == redirect.headers["x-kova-process-id"]
        finally:
            process.terminate()
            process.wait(timeout=10)

"""Wake private per-tenant alarms after the authoritative PostgreSQL commit."""

import logging
import sys


def _wake_native_container(tenant_id):
    from uuid import UUID

    import httpx

    try:
        tenant = str(UUID(str(tenant_id)))
        # Cloudflare intercepts this virtual hostname inside the container.
        # It is never an Internet API endpoint. Do not forward ambient proxies
        # or follow redirects that could disclose the tenant outside the binding.
        with httpx.Client(timeout=2.0, trust_env=False, follow_redirects=False) as client:
            response = client.post(
                "http://jobs.kova.internal/wake", json={"tenantId": tenant}
            )
            response.raise_for_status()
    except Exception:
        # The authoritative PostgreSQL job was committed before this call.
        # Preserve it for the existing scheduled sweep; no rollback or replay.
        logging.getLogger(__name__).warning("Assistant scheduling unavailable")


def wake(tenant_id):
    if sys.platform != "emscripten":
        from app.config import settings

        if settings.cloudflare_container_mode:
            _wake_native_container(tenant_id)
        return
    from pyodide.ffi import run_sync

    from app.workers.context import environment

    try:
        env = environment.get()
        run_sync(env.JOBS.getByName(str(tenant_id)).wake(str(tenant_id)))
    except Exception:
        # A five-minute sweep recovers a lost wake. The committed job remains
        # authoritative and is never recreated or automatically replayed here.
        logging.getLogger(__name__).warning("Assistant scheduling unavailable")

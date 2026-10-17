"""Wake private per-tenant alarms after the authoritative PostgreSQL commit."""

import logging
import sys


def wake(tenant_id):
    if sys.platform != "emscripten":
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

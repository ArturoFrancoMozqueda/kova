"""Shared, persistent rate limits across API shards on Workers Free."""

import hashlib
import hmac
import logging

from app.config import settings
from app.workers.context import environment


class WorkersRateLimiter:
    def is_allowed(self, key, max_requests, window_seconds, fail_closed=False):
        from pyodide.ffi import run_sync

        try:
            env = environment.get()
            if env is None:
                raise RuntimeError("Rate limiter requires a request context")
            # Actor names never contain an IP address, email, tenant or token.
            name = hmac.digest(settings.secret_key.encode(), key.encode(), hashlib.sha256).hex()
            stub = env.RATE_LIMITS.getByName(f"{name}-{window_seconds}")
            result = run_sync(stub.allow(max_requests, window_seconds))
            return bool(result.allowed), int(result.retryAfter)
        except Exception:
            logging.getLogger("app.rate_limit").warning("Workers rate limiter unavailable")
            return (False, 30) if fail_closed else (True, 0)

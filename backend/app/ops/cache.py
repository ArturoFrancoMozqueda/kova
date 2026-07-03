"""Tiny in-memory TTL cache for external-connector results.

Fly runs a single always-on machine (min_machines_running=1, autoscale off), so
a process-local cache is enough to keep the CEO's 1-5 min polling from hammering
external APIs. If the deployment ever scales horizontally this should move to
Upstash (credentials already optional in settings).
"""
import time
from collections.abc import Callable
from threading import Lock
from typing import TypeVar

T = TypeVar("T")

# TTL may be a fixed number of seconds or a callable that derives it from the
# freshly-computed value (e.g. cache a degraded connector result for less time).
TtlSpec = float | Callable[[T], float]


class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, object]] = {}
        self._lock = Lock()

    def get_or_set(self, key: str, ttl_seconds: "TtlSpec", fn: Callable[[], T]) -> T:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is not None and entry[0] > now:
                return entry[1]  # type: ignore[return-value]
        # Compute outside the lock so a slow connector doesn't block other keys.
        value = fn()
        ttl = ttl_seconds(value) if callable(ttl_seconds) else ttl_seconds
        with self._lock:
            self._store[key] = (now + ttl, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Module-level singleton shared across requests.
ops_cache = TTLCache()

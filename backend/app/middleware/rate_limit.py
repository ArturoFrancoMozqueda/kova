"""Per-IP rate limiting with a pluggable backend.

The default backend is a single-process in-memory fixed-window counter. When
``settings.upstash_redis_rest_url`` and ``settings.upstash_redis_rest_token``
are both configured, the limiter switches to Upstash Redis with a sliding
window algorithm. The sliding window is shared across instances and survives
deploys, which is what makes the limit production-safe under horizontal
scaling.

See ``docs/security/rate-limiting.md`` for the threat model and thresholds.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from threading import Lock
from typing import Protocol

from fastapi import HTTPException, Request

from app.config import settings

logger = logging.getLogger("app.rate_limit")

# Retry-After (seconds) we report when failing closed on a backend outage —
# long enough to throttle a brute-force attempt, short enough not to lock a
# real user out for long once Redis recovers.
_FAIL_CLOSED_RETRY_SECONDS = 30


# ── Helpers ────────────────────────────────────────────────────────────────


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _route_pattern(request: Request) -> str:
    """Return the matched route's path pattern (e.g. ``/api/v1/orders/{order_id}/refunds``)
    so that endpoints with path params share one rate-limit bucket instead of
    fragmenting into one bucket per ID.
    """
    route = request.scope.get("route")
    if route is not None and hasattr(route, "path"):
        return route.path  # type: ignore[no-any-return]
    return request.url.path


# ── Backend interface ──────────────────────────────────────────────────────


class _RateLimiterBackend(Protocol):
    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        fail_closed: bool = False,
    ) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)``.

        ``retry_after_seconds`` is ignored when ``allowed`` is True.
        ``fail_closed`` controls behavior when the backend itself errors: when
        True the request is denied, otherwise it is allowed (the default).
        """
        ...


class _InMemoryBackend:
    """Per-bucket fixed-window counter. Single-process only.

    Buckets are keyed by ``(bucket_key, window_seconds)`` so different limits
    on the same identifier (e.g. /login at 20/min and a hypothetical
    /login-burst at 5/10s) don't collide.
    """

    def __init__(self) -> None:
        self._store: dict[tuple[str, int], list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        fail_closed: bool = False,  # noqa: ARG002 — in-memory backend can't fail
    ) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        store_key = (key, window_seconds)
        with self._lock:
            hits = self._store[store_key]
            # Drop expired entries.
            hits[:] = [t for t in hits if t > cutoff]
            if len(hits) >= max_requests:
                # Retry-After: time until the oldest in-window hit expires.
                retry = max(1, int(hits[0] + window_seconds - now) + 1)
                return False, retry
            hits.append(now)
            return True, 0


class _UpstashBackend:
    """Sliding-window limiter backed by Upstash Redis (REST API).

    Instantiates one ``Ratelimit`` per ``(max_requests, window_seconds)`` pair
    and caches it. Each ``limit()`` call costs ~4 Redis commands under the
    sliding-window-counter algorithm bundled with ``upstash-ratelimit``.

    If the network call to Upstash raises, the limiter fails **open**: the
    request is allowed and the exception is logged. We choose availability
    over strict enforcement because Redis-down should not lock out every
    real user.
    """

    def __init__(self, url: str, token: str) -> None:
        from upstash_ratelimit import Ratelimit, SlidingWindow
        from upstash_redis import Redis

        self._redis = Redis(url=url, token=token)
        self._Ratelimit = Ratelimit
        self._SlidingWindow = SlidingWindow
        self._cache: dict[tuple[int, int], object] = {}
        self._lock = Lock()

    def _get_ratelimit(self, max_requests: int, window_seconds: int) -> object:
        cache_key = (max_requests, window_seconds)
        with self._lock:
            rl = self._cache.get(cache_key)
            if rl is None:
                rl = self._Ratelimit(
                    redis=self._redis,
                    limiter=self._SlidingWindow(
                        max_requests=max_requests,
                        window=window_seconds,
                    ),
                    prefix="kova:rl",
                )
                self._cache[cache_key] = rl
            return rl

    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        fail_closed: bool = False,
    ) -> tuple[bool, int]:
        try:
            rl = self._get_ratelimit(max_requests, window_seconds)
            result = rl.limit(key)  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — intentional fail-open/closed handling
            if fail_closed:
                # Auth endpoints in production deny on outage so a Redis blip
                # can't open an unbounded brute-force window.
                logger.exception(
                    "rate_limit_upstash_call_failed_closed",
                    extra={"key": key, "max": max_requests, "window": window_seconds},
                )
                return False, _FAIL_CLOSED_RETRY_SECONDS
            logger.exception(
                "rate_limit_upstash_call_failed",
                extra={"key": key, "max": max_requests, "window": window_seconds},
            )
            return True, 0
        if getattr(result, "allowed", False):
            return True, 0
        # ``reset`` is a unix-ms timestamp when the limit window resets.
        reset_ms = getattr(result, "reset", 0)
        retry = max(1, int(reset_ms / 1000 - time.time()))
        return False, retry


# ── Factory ────────────────────────────────────────────────────────────────


_backend: _RateLimiterBackend | None = None
_backend_lock = Lock()


def _get_backend() -> _RateLimiterBackend:
    global _backend
    if _backend is not None:
        return _backend
    with _backend_lock:
        if _backend is not None:
            return _backend
        url = settings.upstash_redis_rest_url
        token = settings.upstash_redis_rest_token
        if url and token:
            try:
                _backend = _UpstashBackend(url, token)
                logger.info("rate_limit_backend_selected", extra={"backend": "upstash"})
            except Exception:  # noqa: BLE001 — fall back if the lib can't even init
                logger.exception("rate_limit_upstash_init_failed_falling_back")
                _backend = _InMemoryBackend()
        else:
            _backend = _InMemoryBackend()
            logger.info("rate_limit_backend_selected", extra={"backend": "memory"})
        return _backend


def _reset_backend_for_tests() -> None:
    """Internal hook used by tests that mutate settings via monkeypatch."""
    global _backend
    with _backend_lock:
        _backend = None


# ── FastAPI dependency ─────────────────────────────────────────────────────


def rate_limit(
    max_requests: int,
    window_seconds: int = 60,
    *,
    key: str | None = None,
    fail_closed: bool = False,
):
    """Return a FastAPI dependency that enforces ``max_requests / window_seconds``
    per client IP.

    ``key`` names the bucket so distinct endpoints don't share the same quota.
    When ``key`` is omitted, the matched route's path pattern is used.

    ``fail_closed`` denies requests when the backend errors instead of allowing
    them. It only takes effect in production (``settings.app_env == "production"``)
    so staging/local outages never lock developers out; reserve it for auth
    endpoints where a Redis blip must not open a brute-force window.

    Usage::

        @router.post("/login", dependencies=[Depends(rate_limit(20, key="login"))])

    The limiter is a no-op when ``settings.app_env == "local"`` because test
    clients share one IP and we don't want CI flakes.
    """

    def dependency(request: Request) -> None:
        if settings.app_env == "local":
            return
        bucket = key or _route_pattern(request) or "default"
        ip = _get_client_ip(request)
        bucket_key = f"{bucket}:{ip}"
        effective_fail_closed = fail_closed and settings.app_env == "production"
        allowed, retry = _get_backend().is_allowed(
            bucket_key, max_requests, window_seconds, fail_closed=effective_fail_closed
        )
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas peticiones. Intenta de nuevo en unos momentos.",
                headers={"Retry-After": str(retry)},
            )

    return dependency

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class _FixedWindowLimiter:
    """Thread-safe per-IP fixed-window rate limiter (single-instance only)."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._store: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            hits = self._store[key]
            self._store[key] = [t for t in hits if t > cutoff]
            if len(self._store[key]) >= self._max:
                return False
            self._store[key].append(now)
            return True


def rate_limit(max_requests: int, window_seconds: int = 60):
    """
    FastAPI dependency factory for per-IP rate limiting.

    Usage:
        @router.post("/login", dependencies=[Depends(rate_limit(20))])
    """
    limiter = _FixedWindowLimiter(max_requests, window_seconds)

    def dependency(request: Request) -> None:
        ip = _get_client_ip(request)
        if not limiter.is_allowed(ip):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(window_seconds)},
            )

    return dependency

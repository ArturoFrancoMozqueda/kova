"""Native access to the existing durable limiter through a private binding.

Cloudflare intercepts this virtual hostname inside the container's outbound
handler. No endpoint is published on the API, and no raw IP/account identifiers
leave the application. Keep the bucket identity identical to WorkersRateLimiter
so a runtime change cannot reset a client's rate limit.
"""

import hashlib
import hmac
import logging

import httpx

from app.config import settings

_ENDPOINT = "http://rate-limit.kova.internal/allow"
_LOGGER = logging.getLogger("app.rate_limit")


class CloudflareContainerRateLimiter:
    def __init__(self) -> None:
        # Never use ambient HTTP proxies or follow a redirect off the private
        # virtual host. One bounded client is safe across FastAPI worker threads.
        self._client = httpx.Client(
            timeout=2.0,
            trust_env=False,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=4),
        )

    def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
        fail_closed: bool = False,
    ) -> tuple[bool, int]:
        try:
            name = hmac.digest(settings.secret_key.encode(), key.encode(), hashlib.sha256).hex()
            response = self._client.post(
                _ENDPOINT,
                json={
                    "bucket": f"{name}-{window_seconds}",
                    "maximum": max_requests,
                    "windowSeconds": window_seconds,
                },
            )
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("Invalid rate-limit response")
            allowed, retry = result.get("allowed"), result.get("retryAfter")
            if type(allowed) is not bool or type(retry) is not int:
                raise ValueError("Invalid rate-limit response")
            if (allowed and retry != 0) or (not allowed and not 1 <= retry <= window_seconds):
                raise ValueError("Invalid rate-limit retry interval")
            return allowed, retry
        except Exception:
            # Match WorkersRateLimiter's availability contract. Critical auth
            # callers pass fail_closed=True in production. Never retain a local
            # allowance counter or disclose the bucket/key/transport exception.
            _LOGGER.warning("Cloudflare container rate limiter unavailable")
            return (False, 30) if fail_closed else (True, 0)

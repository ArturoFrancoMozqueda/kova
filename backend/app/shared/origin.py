"""Origin/Referer verification for unauthenticated public write endpoints.

The anonymous telemetry endpoint is deliberately cookieless and unauthenticated
so the landing page can record funnel events before a session exists. That makes
it the one public write vector in the API, and in practice it was abused: the
production ``anonymous_telemetry_events`` table accumulated ~48 ``signup_completed``
events in a 30-day window against 2 real accounts created in the same window
(see ``docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md``).

Rate limiting alone cannot separate a browser on our own landing from a script
posting the same JSON. Checking ``Origin`` does, cheaply:

- Browsers set ``Origin`` on every cross-origin request **and** on same-origin
  POST/PUT/PATCH/DELETE, so a legitimate landing beacon always carries it.
- ``Origin`` is a forbidden header name: page JavaScript cannot spoof it.
- A naive script generally omits it entirely.

This is a data-quality guard, not an authentication mechanism. A determined
attacker can still set the header with a non-browser client; the goal is to stop
the ambient noise that makes the funnel unreadable, and to make deliberate
forgery an explicit act rather than an accident.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import Request

from app.config import settings
from app.shared.exceptions import forbidden


def _normalize_origin(value: str | None) -> str | None:
    """Return ``scheme://host[:port]`` for ``value``, or ``None`` if unusable."""
    if not value:
        return None
    try:
        parts = urlsplit(value.strip())
    except ValueError:
        # Browser headers are untrusted. Invalid brackets/IPv6 authorities
        # must fail the origin check instead of producing an HTTP 500.
        return None
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def trusted_origins() -> frozenset[str]:
    """Origins allowed to post to public, unauthenticated write endpoints.

    Derived from ``frontend_url`` (the same value that drives CORS) plus the
    ``www.`` sibling, so a visitor who lands on ``www.kovasuite.com`` is not
    silently dropped from the funnel.
    """
    configured = _normalize_origin(settings.frontend_url)
    if not configured:
        return frozenset()
    origins = {configured}
    parts = urlsplit(configured)
    host = parts.netloc
    if host.startswith("www."):
        origins.add(f"{parts.scheme}://{host[len('www.') :]}")
    else:
        origins.add(f"{parts.scheme}://www.{host}")
    return frozenset(origins)


def request_origin(request: Request) -> str | None:
    """Best-effort origin of `request`, preferring ``Origin`` over ``Referer``.

    ``Referer`` is only a fallback: a browser sending ``Referrer-Policy:
    no-referrer`` omits it, and it can carry a path we do not want to read. Only
    its scheme+host is ever used.
    """
    origin = _normalize_origin(request.headers.get("origin"))
    if origin:
        return origin
    return _normalize_origin(request.headers.get("referer"))


def require_trusted_origin(request: Request) -> None:
    """Reject public writes that did not come from our own front end.

    Fails open when no allowlist can be derived (misconfigured ``frontend_url``)
    so a deploy-time configuration slip degrades telemetry quality rather than
    breaking the landing page.
    """
    allowed = trusted_origins()
    if not allowed:
        return
    if request_origin(request) in allowed:
        return
    raise forbidden("Request origin is not allowed")

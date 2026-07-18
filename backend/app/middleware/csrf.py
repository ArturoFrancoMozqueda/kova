"""CSRF protection for cookie-authenticated, state-changing requests.

Implements the double-submit cookie pattern: a random token is stored in a
non-HttpOnly cookie (`csrf_token`) and must be echoed by the client in the
`X-CSRF-Token` header on POST/PUT/PATCH/DELETE requests that carry an auth
cookie. The two values are compared in constant time.

See `docs/security/cookie-csrf-threat-model.md` for the full rationale.
"""
from __future__ import annotations

import hmac
import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.config import settings

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"
CSRF_COOKIE_PATH = "/"
CSRF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days, matches refresh_token TTL

# State-changing methods that require CSRF validation when cookie auth is in play.
_PROTECTED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Paths that bypass CSRF enforcement. These either run before any auth cookie
# is set (login, signup, email-token flows) or use a non-cookie auth scheme
# (Stripe signature, internal API key).
_EXEMPT_PATHS = frozenset(
    {
        "/api/v1/auth/login",
        "/api/v1/auth/signup",
        "/api/v1/auth/verify",
        "/api/v1/auth/password-reset/request",
        "/api/v1/auth/password-reset/confirm",
        "/api/v1/billing/webhooks/stripe",
    }
)


def generate_csrf_token() -> str:
    """Return a new opaque CSRF token (URL-safe, ~256 bits of entropy)."""
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str | None = None) -> str:
    """Set the CSRF cookie on `response` and return the token value.

    The cookie is intentionally **not** HttpOnly because the SPA must read it
    and echo it via the `X-CSRF-Token` header.
    """
    value = token or generate_csrf_token()
    response.set_cookie(
        CSRF_COOKIE_NAME,
        value,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=CSRF_COOKIE_MAX_AGE,
        path=CSRF_COOKIE_PATH,
    )
    return value


def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(CSRF_COOKIE_NAME, path=CSRF_COOKIE_PATH)


def _is_cookie_auth_request(request: Request) -> bool:
    """Heuristic: the request relies on cookie auth if it carries either of
    the auth cookies. Stripe webhooks and internal-key calls do not.
    """
    return bool(
        request.cookies.get("access_token") or request.cookies.get("refresh_token")
    )


def _is_internal_key_request(request: Request) -> bool:
    key = request.headers.get("x-internal-key")
    expected = settings.internal_api_key
    return bool(expected) and bool(key) and _constant_time_text_equal(key, expected)


def _is_exempt(request: Request) -> bool:
    if request.url.path in _EXEMPT_PATHS:
        return True
    if _is_internal_key_request(request):
        return True
    return False


def _tokens_match(cookie_value: str, header_value: str) -> bool:
    if not cookie_value or not header_value:
        return False
    return _constant_time_text_equal(cookie_value, header_value)


def _constant_time_text_equal(left: str, right: str) -> bool:
    """Compare arbitrary header text without compare_digest's ASCII-only str limit."""
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


async def csrf_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    method = request.method.upper()
    if method not in _PROTECTED_METHODS:
        return await call_next(request)

    if _is_exempt(request):
        return await call_next(request)

    if not _is_cookie_auth_request(request):
        # No cookie auth in play (e.g. unauthenticated request that will fail
        # later, or a future bearer-token scheme). Let the route handler
        # reject as appropriate.
        return await call_next(request)

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if not _tokens_match(cookie_token, header_token):
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF validation failed"},
        )

    return await call_next(request)

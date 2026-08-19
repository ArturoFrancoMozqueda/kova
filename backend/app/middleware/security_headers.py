from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.config import settings

# Swagger UI and ReDoc pull their assets from a CDN and run inline scripts, so
# the locked-down API policy below would break them. They are already disabled
# in production (main.py sets docs_url=None); this only keeps them usable in
# local/CI/staging.
_DOCS_PATHS = frozenset({"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"})

# The API only ever returns JSON and image bytes — it never legitimately loads a
# script, stylesheet, or frame. Denying everything means a response rendered
# directly in a browser (e.g. a reflected payload reached via a typed URL) has
# no way to execute anything.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


async def security_headers_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.path not in _DOCS_PATHS:
        response.headers["Content-Security-Policy"] = _API_CSP
    if request.url.path.startswith("/api/v1/internal/ops"):
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
    return response

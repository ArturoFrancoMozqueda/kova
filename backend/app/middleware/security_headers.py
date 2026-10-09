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
    # API responses include identity, private business data and token/cookie
    # issuance. Explicitly exclude them from browsers and shared caches even
    # when an unauthenticated probe or an error has no Set-Cookie header.
    # Public documents and hashed frontend assets use their separate policy.
    cache_control = response.headers.get("Cache-Control", "")
    # The only public API cache policies are explicitly issued by the two
    # unauthenticated image routes. Preserve their existing byte-response
    # contract, but never treat an arbitrary public JSON policy as safe.
    public_image = (
        request.method in {"GET", "HEAD"}
        and response.status_code == 200
        and response.headers.get("Content-Type", "").startswith("image/")
        and (
            request.url.path.startswith("/api/v1/settings/receipt/logo/")
            or (
                request.url.path.startswith("/api/v1/catalog/products/")
                and request.url.path.endswith("/image")
            )
        )
        and cache_control.startswith("public,")
    )
    if request.url.path.startswith("/api/v1/") and not public_image:
        # Exports already promise exactly no-store; retain that stronger
        # explicit exclusion while adding CDN directives below.
        if "no-store" not in {part.strip().lower() for part in cache_control.split(",")}:
            response.headers["Cache-Control"] = "private, no-store, max-age=0"
        response.headers["CDN-Cache-Control"] = "no-store"
        response.headers["Vercel-CDN-Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
    return response

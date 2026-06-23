from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

# Generous global ceiling: above the largest legitimate upload (1 MB product
# image) so JSON endpoints and uploads alike are covered, while still rejecting
# oversized bodies / JSON bombs. Per-route upload handlers keep their tighter
# caps (512 KB logo, 1 MB image).
MAX_REQUEST_BYTES = 2 * 1024 * 1024


async def body_size_limit_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    # Browser clients (fetch/XHR) always set Content-Length for JSON and
    # multipart bodies, so the declared length is a reliable, cheap early gate.
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length"})
        if declared > MAX_REQUEST_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)

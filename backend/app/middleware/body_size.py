from collections.abc import Awaitable, Callable
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import Message, Receive, Scope, Send

# Generous global ceiling: above the largest legitimate upload (1 MB product
# image) so JSON endpoints and uploads alike are covered, while still rejecting
# oversized bodies / JSON bombs. Per-route upload handlers keep their tighter
# caps (512 KB logo, 1 MB image).
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """ASGI-native byte limit that also covers chunked requests."""

    def __init__(self, app: Callable[..., Awaitable[Any]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = MAX_REQUEST_BYTES
        if scope.get("path") == "/api/v1/assistant/documents" and scope.get("method") == "POST":
            limit = 20 * 1024 * 1024
        if scope.get("path") == "/api/v1/integrations/cfdi/setup/certificate":
            limit = 150 * 1024
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                await self._reject(400, "Invalid Content-Length", scope, receive, send)
                return
            if declared < 0:
                await self._reject(400, "Invalid Content-Length", scope, receive, send)
                return
            if declared > limit:
                await self._reject(413, "Request body too large", scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(413, "Request body too large", scope, receive, send)

    @staticmethod
    async def _reject(
        status_code: int,
        detail: str,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        response = JSONResponse(status_code=status_code, content={"detail": detail})
        await response(scope, receive, send)

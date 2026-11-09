"""Native response identity and the private HTTP/1 connection policy."""

import re
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ResidentIdentityMiddleware:
    def __init__(self, app: ASGIApp, *, boot_controller_sha: str | None = None) -> None:
        self.app = app
        # Capture only the public build identity supplied at process startup.
        # Missing/invalid values remain absent so the controller can reject a
        # legacy boot without exporting any environment or provider setting.
        self.boot_controller_sha = (
            boot_controller_sha.encode("ascii")
            if isinstance(boot_controller_sha, str)
            and re.fullmatch(r"[a-fA-F0-9]{40}", boot_controller_sha)
            else None
        )
        # Random boot identity only: contains no OS PID, credentials or tenant
        # metadata. It changes on process restart, not per request or account.
        self.process_id = uuid4().hex.encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # This listener is reached only through the Container SDK. Explicitly
        # close each private HTTP/1 hop after its response, so the proxy cannot
        # reuse an origin socket across Uvicorn's idle keep-alive shutdown.
        # This does not retry a dispatched request or change public sessions.
        close_connection = scope.get("http_version") in ("1.0", "1.1")

        async def send_with_identity(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in (
                        b"x-kova-runtime", b"x-kova-process-id", b"x-kova-boot-controller-sha",
                    )
                    and not (close_connection and name.lower() in (b"connection", b"keep-alive"))
                ]
                if close_connection:
                    headers.append((b"connection", b"close"))
                if (scope.get("path") == "/health" and message["status"] == 200
                        and self.boot_controller_sha is not None):
                    headers.append((b"x-kova-boot-controller-sha", self.boot_controller_sha))
                message = {
                    **message,
                    "headers": headers + [
                        (b"x-kova-runtime", b"native-resident"),
                        (b"x-kova-process-id", self.process_id),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_identity)

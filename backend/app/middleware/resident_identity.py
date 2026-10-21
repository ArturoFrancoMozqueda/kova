"""Public runtime identity for verifying resident-process deployment behavior."""

from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ResidentIdentityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        # Random boot identity only: contains no OS PID, credentials or tenant
        # metadata. It changes on process restart, not per request or account.
        self.process_id = uuid4().hex.encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_identity(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in (b"x-kova-runtime", b"x-kova-process-id")
                ]
                message = {
                    **message,
                    "headers": headers + [
                        (b"x-kova-runtime", b"native-resident"),
                        (b"x-kova-process-id", self.process_id),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_identity)

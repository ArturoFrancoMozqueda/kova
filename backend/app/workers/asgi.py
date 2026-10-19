"""Keep synchronous Python I/O serialized until ASGI dependency cleanup ends."""

import asyncio


class RequestCoordinator:
    def __init__(self):
        self._requests = asyncio.Lock()

    async def fetch(self, application, request, env, ctx):
        from workers import asgi, wait_until

        await self._requests.acquire()
        transferred = False
        finished = asyncio.Event()

        async def tracked(scope, receive, send):
            first_body = None
            streaming = False

            async def send_body(message):
                nonlocal first_body, streaming
                if message["type"] == "http.response.body" and not streaming:
                    if first_body is not None:
                        if not message.get("body") and not message.get("more_body", False):
                            # BaseHTTPMiddleware wraps a buffered JSON/bytes
                            # response in one chunk plus an empty terminator.
                            # Preserve that buffered response at the SDK edge.
                            await send({**first_body, "more_body": False})
                            first_body = None
                            return
                        await send(first_body)
                        first_body = None
                        streaming = True
                    elif message.get("more_body", False):
                        # Retain one existing chunk only. A second data chunk
                        # starts genuine streaming with normal backpressure.
                        first_body = message
                        return
                await send(message)

            try:
                await app(scope, receive, send_body)
            finally:
                if scope["type"] == "http":
                    finished.set()

        async def release_after_cleanup():
            try:
                await finished.wait()
            finally:
                self._requests.release()

        try:
            app = await application(env)
            response = await asgi.fetch(tracked, request, env, ctx)
            if not finished.is_set():
                # HTTP middleware makes even JSON responses streams. The SDK
                # returns their headers before FastAPI closes its DB sessions.
                # Let the consumer drain the body; retain admission until the
                # ASGI task (including dependency cleanup) has actually ended.
                wait_until(asgi.run_in_background(release_after_cleanup()))
                transferred = True
            return response
        finally:
            if not transferred:
                self._requests.release()

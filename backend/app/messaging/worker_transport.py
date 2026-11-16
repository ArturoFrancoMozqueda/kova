"""Synchronous domain contract over bounded async HTTP in Python Workers.

Only the reservation scheduler uses this bridge. Manual sends retain their
native-runtime guard; no public route or tenant URL can select this transport.
"""

import asyncio

import httpx

from app.messaging.whatsapp import API_HOST, MAX_RESPONSE_BYTES, ChannelError


class GraphWorkerTransport(httpx.BaseTransport):
    def handle_request(self, request):
        if str(request.url).split("/", 3)[:3] != ["https:", "", API_HOST.removeprefix("https://")]:
            raise ChannelError("provider_host_invalid")
        from pyodide.ffi import run_sync

        return run_sync(self._request(request))

    async def _request(self, request):
        try:
            async with asyncio.timeout(10):
                async with httpx.AsyncClient(
                    timeout=10, follow_redirects=False, trust_env=False
                ) as client:
                    async with client.stream(
                        request.method,
                        str(request.url),
                        headers=dict(request.headers),
                        content=request.content,
                    ) as response:
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > MAX_RESPONSE_BYTES:
                                raise ChannelError(
                                    "provider_response_invalid", ambiguous=request.method == "POST"
                                )
                        return httpx.Response(
                            response.status_code,
                            headers=response.headers,
                            content=bytes(content),
                            request=request,
                        )
        except ChannelError:
            raise
        except Exception:
            raise ChannelError(
                "provider_request_failed", ambiguous=request.method == "POST"
            ) from None

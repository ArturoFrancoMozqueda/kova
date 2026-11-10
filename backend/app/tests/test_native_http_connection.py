"""The private native HTTP hop must not leave reusable idle origin sockets."""

import asyncio

import pytest
import uvicorn
from uvicorn.protocols.http.h11_impl import H11Protocol
from uvicorn.server import ServerState

from app.middleware.resident_identity import ResidentIdentityMiddleware


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_native_http_origin_closes_after_one_unchanged_response(method):
    async def exercise():
        requests = []

        async def original(scope, receive, send):
            body = bytearray()
            while True:
                event = await receive()
                body.extend(event.get("body", b""))
                if not event.get("more_body", False):
                    break
            requests.append((scope["method"], bytes(body)))
            await send({
                "type": "http.response.start", "status": 201,
                "headers": [
                    (b"content-length", b"9"),
                    (b"connection", b"keep-alive"),
                    (b"set-cookie", b"session=synthetic; HttpOnly; Secure"),
                    (b"set-cookie", b"csrf=synthetic; Secure"),
                ],
            })
            await send({"type": "http.response.body", "body": b"unchanged"})

        config = uvicorn.Config(ResidentIdentityMiddleware(original), access_log=False,
                                log_config=None, lifespan="off", timeout_keep_alive=5)
        config.load()
        loop = asyncio.get_running_loop()
        state = ServerState()
        server = await loop.create_server(
            lambda: H11Protocol(config, state, {}, _loop=loop), "127.0.0.1", 0,
        )
        reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
        try:
            payload = b"synthetic-request" if method == "POST" else b""
            writer.write(f"{method} /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n"
                         f"Content-Length: {len(payload)}\r\n\r\n".encode() + payload)
            await writer.drain()
            headers = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            assert b"connection: close\r\n" in headers.lower()
            assert b"connection: keep-alive\r\n" not in headers.lower()
            assert b"HTTP/1.1 201" in headers
            assert headers.lower().count(b"set-cookie:") == 2
            # read() finishes only at EOF: this verifies real Uvicorn transport
            # closure, rather than just checking a middleware header literal.
            assert await asyncio.wait_for(reader.read(), 2) == b"unchanged"
            assert requests == [(method, payload)], "no replay or payload rewrite"
        finally:
            writer.close()
            await writer.wait_closed()
            server.close()
            await server.wait_closed()
            if state.tasks:
                await asyncio.gather(*state.tasks)

    asyncio.run(exercise())


@pytest.mark.parametrize("scope", [
    {"type": "websocket"},
    {"type": "http", "http_version": "2"},
])
def test_native_connection_policy_does_not_add_http1_headers_to_other_protocols(scope):
    sent = []

    original_message = ({"type": "websocket.accept", "headers": []}
                        if scope["type"] == "websocket"
                        else {"type": "http.response.start", "status": 200, "headers": []})

    async def original(_scope, receive, send):
        await send(original_message)

    async def receive():
        return {}

    async def send(message):
        sent.append(message)

    asyncio.run(ResidentIdentityMiddleware(original)(scope, receive, send))
    assert b"connection" not in dict(sent[0]["headers"])
    if scope["type"] == "websocket":
        assert sent == [original_message]

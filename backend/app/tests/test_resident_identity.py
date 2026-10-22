"""Deployment diagnostics never rewrite HTTP bodies, cookies or lifecycles."""

import asyncio

from app.middleware.resident_identity import ResidentIdentityMiddleware


def test_resident_identity_stays_stable_until_process_restart():
    async def original(scope, receive, send):
        await send({
            "type": "http.response.start", "status": 401,
            "headers": [
                (b"set-cookie", b"access_token=synthetic; HttpOnly; Secure"),
                (b"set-cookie", b"csrf_token=synthetic; Secure"),
                (b"x-kova-runtime", b"obsolete"),
            ],
        })
        await send({"type": "http.response.body", "body": b'{"detail":"unauthorized"}'})

    async def exercise():
        wrapped = ResidentIdentityMiddleware(original)
        first, second = [], []

        async def receive():
            return {"type": "http.request", "body": b""}

        async def first_send(message):
            first.append(message)

        async def second_send(message):
            second.append(message)

        await wrapped({"type": "http"}, receive, first_send)
        await wrapped({"type": "http"}, receive, second_send)
        return wrapped, first, second

    wrapped, first, second = asyncio.run(exercise())
    headers = first[0]["headers"]
    assert first[0]["status"] == 401
    assert [value for name, value in headers if name == b"set-cookie"] == [
        b"access_token=synthetic; HttpOnly; Secure", b"csrf_token=synthetic; Secure"
    ]
    assert [value for name, value in headers if name == b"x-kova-runtime"] == [b"native-resident"]
    assert dict(headers)[b"x-kova-process-id"] == wrapped.process_id
    assert first == second
    assert first[1] == {
        "type": "http.response.body", "body": b'{"detail":"unauthorized"}'
    }
    assert wrapped.process_id != ResidentIdentityMiddleware(original).process_id


def test_resident_identity_passes_lifespan_through_without_headers():
    sent = []

    async def original(scope, receive, send):
        assert scope["type"] == "lifespan"
        await send({"type": "lifespan.startup.complete"})

    async def exercise():
        async def receive():
            return {"type": "lifespan.startup"}

        async def send(message):
            sent.append(message)

        await ResidentIdentityMiddleware(original)({"type": "lifespan"}, receive, send)

    asyncio.run(exercise())
    assert sent == [{"type": "lifespan.startup.complete"}]

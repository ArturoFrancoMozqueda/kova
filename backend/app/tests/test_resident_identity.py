"""Deployment diagnostics never rewrite HTTP bodies, cookies or lifecycles."""

import asyncio

import pytest

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


@pytest.mark.parametrize("path,status,expected", [
    ("/health", 200, True),
    ("/health", 503, False),
    ("/health/db", 200, False),
    ("/api/v1/auth/session", 200, False),
])
def test_boot_controller_identity_is_trusted_startup_metadata_only(path, status, expected):
    boot_sha = "b" * 40

    async def original(scope, receive, send):
        await send({
            "type": "http.response.start", "status": status,
            "headers": [
                (b"X-Kova-Boot-Controller-Sha", b"untrusted-response-value"),
                (b"set-cookie", b"session=synthetic; HttpOnly; Secure"),
            ],
        })
        await send({"type": "http.response.body", "body": b"unchanged"})

    async def exercise():
        sent = []

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            sent.append(message)

        wrapped = ResidentIdentityMiddleware(original, boot_controller_sha=boot_sha)
        await wrapped({
            "type": "http", "path": path,
            "headers": [(b"x-kova-boot-controller-sha", b"request-cannot-override-startup")],
        }, receive, send)
        return sent

    sent = asyncio.run(exercise())
    headers = sent[0]["headers"]
    assert [value for name, value in headers if name.lower() == b"x-kova-boot-controller-sha"] == (
        [boot_sha.encode("ascii")] if expected else []
    )
    assert sent[0]["status"] == status
    assert [value for name, value in headers if name == b"set-cookie"] == [
        b"session=synthetic; HttpOnly; Secure"
    ]
    assert sent[1] == {"type": "http.response.body", "body": b"unchanged"}


@pytest.mark.parametrize("boot_sha", [None, "", "a" * 39, "a" * 41, "g" * 40, "a" * 40 + "\n"])
def test_legacy_or_invalid_boot_identity_cannot_be_forged_by_a_response(boot_sha):
    sent = []

    async def original(scope, receive, send):
        await send({
            "type": "http.response.start", "status": 200,
            "headers": [(b"x-kova-boot-controller-sha", b"c" * 40)],
        })

    async def exercise():
        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            sent.append(message)

        await ResidentIdentityMiddleware(original, boot_controller_sha=boot_sha)(
            {"type": "http", "path": "/health"}, receive, send,
        )

    asyncio.run(exercise())
    assert not any(name == b"x-kova-boot-controller-sha" for name, _ in sent[0]["headers"])

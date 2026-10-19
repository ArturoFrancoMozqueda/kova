import asyncio
import sys
from types import SimpleNamespace

import pytest

from app.workers.asgi import RequestCoordinator


@pytest.mark.parametrize("chunks", [[b"one"], [b"one", b"two", b"three"]])
def test_single_chunk_middleware_response_is_buffered_but_exports_keep_streaming(monkeypatch, chunks):
    async def scenario():
        messages = []
        cleaned = False

        async def app(scope, receive, send):
            nonlocal cleaned
            await send({"type": "http.response.start", "status": 200})
            for chunk in chunks:
                await send({"type": "http.response.body", "body": chunk, "more_body": True})
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            cleaned = True

        async def application(env):
            return app

        async def sdk_fetch(tracked, request, env, ctx):
            async def send(message):
                messages.append(message)

            await tracked({"type": "http"}, None, send)
            return "response"

        monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(
            asgi=SimpleNamespace(fetch=sdk_fetch),
            wait_until=lambda coro: pytest.fail("Buffered response left unfinished"),
        ))
        assert await RequestCoordinator().fetch(application, None, None, None) == "response"
        assert cleaned
        bodies = [message for message in messages if message["type"] == "http.response.body"]
        assert b"".join(message["body"] for message in bodies) == b"".join(chunks)
        assert bodies[-1]["more_body"] is False
        if len(chunks) == 1:
            assert len(bodies) == 1
        else:
            assert [message["body"] for message in bodies[:-1]] == chunks
            assert all(message["more_body"] for message in bodies[:-1])

    asyncio.run(scenario())


def test_stream_headers_do_not_release_admission_before_dependency_cleanup(monkeypatch):
    async def scenario():
        coordinator = RequestCoordinator()
        admitted = []
        pending = []
        responses = {}

        async def app(scope, receive, send):
            request = scope["request"]
            try:
                await send({"type": "headers"})
                await responses[request].drained.wait()
            finally:
                # FastAPI can close its transaction after the body is drained.
                await responses[request].cleanup.wait()

        async def application(env):
            admitted.append(env)
            return app

        async def sdk_fetch(tracked, request, env, ctx):
            headers = asyncio.Event()
            response = SimpleNamespace(drained=asyncio.Event(), cleanup=asyncio.Event())
            responses[request] = response

            async def send(message):
                headers.set()

            pending.append(asyncio.create_task(tracked(
                {"type": "http", "request": request}, None, send,
            )))
            await headers.wait()
            return response

        monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(
            asgi=SimpleNamespace(fetch=sdk_fetch, run_in_background=asyncio.create_task),
            wait_until=lambda coro: pending.append(asyncio.ensure_future(coro)),
        ))
        first = await coordinator.fetch(application, "first", "tenant-one", None)
        second_task = asyncio.create_task(
            coordinator.fetch(application, "second", "tenant-two", None),
        )
        await asyncio.sleep(0)
        assert admitted == ["tenant-one"]
        first.drained.set()
        await asyncio.sleep(0)
        assert admitted == ["tenant-one"]
        first.cleanup.set()
        second = await asyncio.wait_for(second_task, timeout=1)
        assert admitted == ["tenant-one", "tenant-two"]
        second.drained.set()
        second.cleanup.set()
        await asyncio.gather(*pending)

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["startup", "request", "cancelled_waiter"])
def test_failed_requests_and_cancelled_waiters_preserve_admission(monkeypatch, failure):
    async def scenario():
        coordinator = RequestCoordinator()
        ready = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def application(env):
            nonlocal calls
            calls += 1
            if calls == 1 and failure == "startup":
                raise RuntimeError("Synthetic startup failure")

            async def app(scope, receive, send):
                if calls == 1 and failure == "request":
                    raise RuntimeError("Synthetic request failure")
                ready.set()
                await release.wait()

            return app

        async def sdk_fetch(app, request, env, ctx):
            await app({"type": "http"}, None, None)
            return "response"

        monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(
            asgi=SimpleNamespace(fetch=sdk_fetch),
            wait_until=lambda coro: pytest.fail("Buffered response left unfinished"),
        ))
        if failure == "cancelled_waiter":
            first = asyncio.create_task(coordinator.fetch(application, None, None, None))
            await ready.wait()
            waiter = asyncio.create_task(coordinator.fetch(application, None, None, None))
            await asyncio.sleep(0)
            waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiter
            assert calls == 1
            release.set()
            assert await first == "response"
        else:
            with pytest.raises(RuntimeError, match="Synthetic"):
                await coordinator.fetch(application, None, None, None)
            release.set()
        assert await asyncio.wait_for(
            coordinator.fetch(application, None, None, None), timeout=1,
        ) == "response"

    asyncio.run(scenario())

import asyncio
import time
from collections import Counter

import anyio
import httpx
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app import db as database
from app.config import settings, sqlalchemy_database_url


@pytest.mark.parametrize("privileged,pool_size,workers", [(False, 1, 2), (True, 4, 5)])
def test_request_admission_keeps_database_waiters_out_of_endpoint_workers(monkeypatch, privileged, pool_size, workers):
    # A real PostgreSQL pool smaller than the sync worker limit reproduces the
    # same acquisition -> another sync dependency -> endpoint scheduling used
    # by authenticated routes. This is not a synthetic semaphore-only test.
    engine = create_engine(
        sqlalchemy_database_url(settings.effective_app_database_url),
        pool_size=pool_size, max_overflow=0, pool_timeout=0.3, hide_parameters=True,
    )
    monkeypatch.setattr(database, "PrivilegedSessionLocal" if privileged else "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(settings, "database_pool_size", pool_size)
    monkeypatch.setattr(settings, "database_max_overflow", 0)
    dependency = database.get_privileged_db if privileged else database.get_db
    app = FastAPI()

    def acquire_connection(db: Session = Depends(dependency)):
        assert db.scalar(text("SELECT 1")) == 1
        time.sleep(0.03)
        return db

    @app.get("/probe")
    def endpoint(db: Session = Depends(acquire_connection)):
        return {"value": db.scalar(text("SELECT 1"))}

    @app.get("/failure")
    def failure(db: Session = Depends(acquire_connection)):
        raise RuntimeError("Controlled endpoint failure")

    async def run():
        limiter = anyio.to_thread.current_default_thread_limiter()
        previous = limiter.total_tokens
        limiter.total_tokens = workers
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
                responses = await asyncio.gather(*(client.get("/probe") for _ in range(8)))
                assert (await client.get("/failure")).status_code == 500
                assert (await client.get("/probe")).status_code == 200
            assert Counter(response.status_code for response in responses) == {200: 8}
            assert all(response.json() == {"value": 1} for response in responses)
            assert engine.pool.checkedout() == 0
        finally:
            limiter.total_tokens = previous

    try:
        asyncio.run(run())
        # New loop, same dependency/engine: no stale waiter or loop affinity.
        asyncio.run(run())
        for _ in range(2):
            with TestClient(app) as client:
                assert client.get("/probe").json() == {"value": 1}
    finally:
        engine.dispose()


def test_cancelled_admission_waiter_leaves_database_capacity_available(monkeypatch):
    engine = create_engine(
        sqlalchemy_database_url(settings.effective_app_database_url),
        pool_size=1, max_overflow=0, pool_timeout=0.3, hide_parameters=True,
    )
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(settings, "database_pool_size", 1)
    monkeypatch.setattr(settings, "database_max_overflow", 0)

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        app = FastAPI()

        @app.get("/probe")
        async def endpoint(db: Session = Depends(database.get_db)):
            assert await anyio.to_thread.run_sync(lambda: db.scalar(text("SELECT 1"))) == 1
            entered.set()
            await release.wait()
            return {"value": 1}

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(client.get("/probe"))
            await entered.wait()
            gate = database._request_limiter("runtime", 1)
            cancelled = asyncio.create_task(client.get("/probe"))
            with anyio.fail_after(1):
                while gate.statistics().tasks_waiting != 1:
                    await anyio.sleep(0)
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            assert gate.statistics().tasks_waiting == 0
            assert gate.borrowed_tokens == 1
            assert engine.pool.checkedout() == 1
            next_request = asyncio.create_task(client.get("/probe"))
            release.set()
            responses = await asyncio.gather(first, next_request)
            assert all(response.status_code == 200 for response in responses)
            assert gate.borrowed_tokens == 0
            assert engine.pool.checkedout() == 0

    try:
        asyncio.run(run())
    finally:
        engine.dispose()

"""Thin gateway + bounded request coordination; all POS data stays in Postgres."""

import importlib
import logging
import math
import time
from urllib.parse import urlparse

from workers import DurableObject, WorkerEntrypoint

from app.workers.asgi import RequestCoordinator
from app.workers.routing import coordinator_shard

# Cloudflare snapshots top-level imports at deployment. Load pure package code
# here; application settings, database validation and request I/O remain inside
# the invocation so no credentials or connections enter the shared snapshot.
for _package in (
    "fastapi", "sqlalchemy.orm", "pg8000.dbapi", "pydantic_settings",
    "boto3", "openpyxl", "pypdf", "sentry_sdk", "httpx",
):
    importlib.import_module(_package)


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        # A routing hint only: permissions and session validity are checked by
        # the unchanged API. Names contain neither tokens nor customer values.
        shard = coordinator_shard(request.headers.get("cookie"), urlparse(request.url).path)
        return await self.env.API.getByName(f"api-{shard}").fetch(request)


class KovaApi(DurableObject):
    def __init__(self, ctx, env):
        super().__init__(ctx, env)
        # Keep admission local to this object's I/O context. A global asyncio
        # waiter can resume another object's work in the wrong I/O context.
        self._requests = RequestCoordinator()
        self._observations = 0

    async def fetch(self, request):
        from app.workers.bootstrap import application
        from app.workers.context import environment, execution

        self._observations += 1
        started = time.perf_counter()
        env_token = environment.set(self.env)
        ctx_token = execution.set(self.ctx)
        try:
            response = await self._requests.fetch(application, request, self.env, self.ctx)
            if self._observations <= 3:
                logging.getLogger("app.workers").info(
                    "workers_api_timing sequence=%d response_headers_ms=%.1f",
                    self._observations, (time.perf_counter() - started) * 1000,
                )
            return response
        finally:
            execution.reset(ctx_token)
            environment.reset(env_token)


class KovaRateLimit(DurableObject):
    async def allow(self, maximum, window_seconds):
        if not (
            isinstance(maximum, int)
            and 0 < maximum <= 1_000_000
            and isinstance(window_seconds, int)
            and 0 < window_seconds <= 86400
        ):
            raise ValueError("Invalid rate limit")
        now = int(time.time() * 1000)
        window = window_seconds * 1000
        sql = self.ctx.storage.sql
        sql.exec("CREATE TABLE IF NOT EXISTS hits (at INTEGER NOT NULL)")
        sql.exec("DELETE FROM hits WHERE at <= ?", now - window)
        row = sql.exec("SELECT count(*) AS n, min(at) AS first FROM hits").one()
        if row.n >= maximum:
            return {
                "allowed": False,
                "retryAfter": max(1, math.ceil((row.first + window - now) / 1000)),
            }
        sql.exec("INSERT INTO hits(at) VALUES (?)", now)
        # Do not retain hashed buckets indefinitely after activity stops.
        await self.ctx.storage.put("expires", now + window)
        await self.ctx.storage.setAlarm(now + window)
        return {"allowed": True, "retryAfter": 0}

    async def alarm(self):
        expires = await self.ctx.storage.get("expires")
        if expires is not None and expires > time.time() * 1000:
            await self.ctx.storage.setAlarm(expires)
        else:
            await self.ctx.storage.deleteAll()

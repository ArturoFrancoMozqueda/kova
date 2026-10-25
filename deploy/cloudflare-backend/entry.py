"""Thin gateway + bounded request coordination; all POS data stays in Postgres."""

import importlib
import logging
import math
import sys
import time
from urllib.parse import urlparse

from workers import DurableObject, WorkerEntrypoint

from app.workers.asgi import RequestCoordinator
from app.workers.routing import coordinator_shard

# Snapshot library code only. Routers and their model/validator graphs load for
# the requested domain inside the coordinator. Security checks still precede
# every served request.
# Never load settings, engines, credentials or request state into the snapshot.
_SNAPSHOT_PACKAGES = (
    "fastapi", "sqlalchemy.orm", "pg8000.dbapi", "pydantic_settings",
    "sentry_sdk", "httpx",
)
for _package in _SNAPSHOT_PACKAGES:
    importlib.import_module(_package)

# Audited pure-file inventories, retained for boundary and registry regression
# checks. These declarations are no longer eagerly imported into the snapshot.
_MODEL_MODULES = (
    'app.account_lifecycle.models',
    'app.appointments.models',
    'app.assistant.models',
    'app.audit.models',
    'app.auth.models',
    'app.automations.models',
    'app.billing.models',
    'app.branches.models',
    'app.business_settings.models',
    'app.catalog.models',
    'app.cfdi.models',
    'app.crm.engagement_models',
    'app.crm.models',
    'app.customer_orders.models',
    'app.customers.models',
    'app.employees.models',
    'app.expenses.models',
    'app.fiscal.models',
    'app.hardware.models',
    'app.idempotency.models',
    'app.integrations.models',
    'app.inventory.models',
    'app.loyalty.models',
    'app.messaging.models',
    'app.modifiers.models',
    'app.onboarding.models',
    'app.ops.models',
    'app.orders.models',
    'app.purchasing.models',
    'app.quotes.models',
    'app.rbac.models',
    'app.reconciliation.models',
    'app.service_cases.models',
    'app.shifts.models',
    'app.storefront.models',
    'app.telemetry.models',
    'app.tenants.models',
)
_SCHEMA_MODULES = (
    'app.account_lifecycle.schemas',
    'app.appointments.schemas',
    'app.assistant.schemas',
    'app.auth.schemas',
    'app.automations.schemas',
    'app.billing.schemas',
    'app.branches.schemas',
    'app.business_settings.schemas',
    'app.catalog.schemas',
    'app.cfdi.schemas',
    'app.crm.engagement_schemas',
    'app.crm.schemas',
    'app.customer_orders.schemas',
    'app.customers.schemas',
    'app.employees.schemas',
    'app.expenses.schemas',
    'app.fiscal.schemas',
    'app.hardware.schemas',
    'app.imports.schemas',
    'app.integrations.schemas',
    'app.inventory.lot_schemas',
    'app.inventory.schemas',
    'app.loyalty.schemas',
    'app.messaging.schemas',
    'app.modifiers.schemas',
    'app.onboarding.schemas',
    'app.operations_queue.schemas',
    'app.ops.schemas',
    'app.orders.schemas',
    'app.purchasing.schemas',
    'app.quotes.schemas',
    'app.reconciliation.schemas',
    'app.reports.control_schemas',
    'app.reports.schemas',
    'app.service_cases.schemas',
    'app.shifts.schemas',
    'app.storefront.schemas',
    'app.sync.schemas',
    'app.telemetry.schemas',
    'app.tenants.schemas',
)
if "app.config" in sys.modules or "app.db" in sys.modules:
    raise RuntimeError("Pure snapshot imports must not load runtime configuration or engines")


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
        self._models_ready = False

    async def fetch(self, request):
        from app.workers.bootstrap import application
        from app.workers.context import environment, execution

        self._observations += 1
        started = time.perf_counter()
        env_token = environment.set(self.env)
        ctx_token = execution.set(self.ctx)
        try:
            async def initialized_application(env):
                if not self._models_ready:
                    # Resolve every ORM foreign key before any flush. This graph
                    # is pure, but belongs to invocation memory rather than the
                    # shared deployment snapshot. Admission serializes loading.
                    for module in _MODEL_MODULES:
                        importlib.import_module(module)
                    self._models_ready = True
                return await application(env)

            response = await self._requests.fetch(
                initialized_application, request, self.env, self.ctx,
            )
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

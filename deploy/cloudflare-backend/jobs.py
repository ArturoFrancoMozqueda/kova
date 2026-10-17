"""Separate least-privilege Worker; no owner database binding or public route."""

import asyncio
import logging
import time
from uuid import UUID

from workers import DurableObject, WorkerEntrypoint

_ready = False


def initialize(env):
    global _ready
    if not _ready:
        from app.workers.context import environment
        from app.workers.bootstrap import configure

        token = environment.set(env)
        try:
            configure(env, privileged=False)
            from app.assistant.access import assert_private_policies
            from app.db import assert_rls_active
            from app.observability.logging import configure_logging
            from app.observability.sentry import init_sentry

            configure_logging()
            init_sentry()
            assert_rls_active()
            assert_private_policies()
            _ready = True
        finally:
            environment.reset(token)


class Default(WorkerEntrypoint):
    async def scheduled(self, controller):
        # Cohort IDs are deployment configuration; no tenant contents are read
        # globally. The job objects independently revalidate enabled membership.
        from app.workers.bootstrap import environment

        values = environment(self.env, privileged=False)
        for value in values.get("ASSISTANT_TENANT_IDS", "").split(","):
            if value.strip():
                tenant = str(UUID(value.strip()))
                await self.env.JOBS.getByName(tenant).wake(tenant)


class KovaJobs(DurableObject):
    def __init__(self, ctx, env):
        super().__init__(ctx, env)
        self._lock = asyncio.Lock()

    async def wake(self, tenant):
        try:
            tenant = str(UUID(tenant))
        except (ValueError, TypeError, AttributeError):
            return False
        async with self._lock:
            initialize(self.env)
            from app.assistant.access import cohort

            if UUID(tenant) not in cohort():
                return False
            stored = await self.ctx.storage.get("tenant")
            if stored is not None and stored != tenant:
                return False
            await self.ctx.storage.put("tenant", tenant)
            if await self.ctx.storage.getAlarm() is None:
                await self.ctx.storage.setAlarm(int(time.time() * 1000) + 1)
        return True

    async def alarm(self):
        from app.workers.context import environment, execution

        async with self._lock:
            env_token = environment.set(self.env)
            ctx_token = execution.set(self.ctx)
            try:
                initialize(self.env)
                from app.assistant.access import enabled
                from app.assistant.worker import process_once

                tenant = await self.ctx.storage.get("tenant")
                if tenant is None or not enabled(UUID(tenant)):
                    return
                # Persist recovery before I/O. One job per invocation, with
                # the existing leases, session checks and uncertain-call rules.
                await self.ctx.storage.setAlarm(int(time.time() * 1000) + 60_000)
                processed = process_once(
                    workload="chat", tenant_id=UUID(tenant), maximum_jobs=1
                )
                if processed:
                    await self.ctx.storage.setAlarm(int(time.time() * 1000) + 1)
                else:
                    await self.ctx.storage.deleteAlarm()
            except Exception:
                logging.getLogger(__name__).error("Assistant job iteration failed")
                raise RuntimeError("Assistant job iteration failed") from None
            finally:
                execution.reset(ctx_token)
                environment.reset(env_token)

"""Separate least-privilege Worker; no owner database binding or public route."""

import asyncio
import logging
import time
from uuid import UUID

from workers import DurableObject, WorkerEntrypoint

_ready = False


def budget_paused(env):
    # Operator-only deployment binding; never derived from a request or tenant.
    return str(getattr(env, "KOVA_BUDGET_PAUSED", "") or "").strip() == "1"


def automation_cohort(env):
    return {
        UUID(value.strip())
        for value in (getattr(env, "AUTOMATION_TENANT_IDS", "") or "").split(",")
        if value.strip()
    }


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
            policy_catalog = assert_rls_active()
            assert_private_policies(policy_catalog=policy_catalog)
            _ready = True
        finally:
            environment.reset(token)


class Default(WorkerEntrypoint):
    async def scheduled(self, controller, env, ctx):
        if budget_paused(env):
            return
        # Cohort IDs are deployment configuration; no tenant contents are read
        # globally. The job objects independently revalidate enabled membership.
        # Keep the Free cron handler small: settings/schema imports and database
        # checks run in the private job object's larger compute budget.
        tenants = automation_cohort(env) | {
            UUID(value.strip())
            for value in (getattr(env, "ASSISTANT_TENANT_IDS", "") or "").split(",")
            if value.strip()
        }
        for tenant_id in sorted(tenants, key=str):
            tenant = str(tenant_id)
            await env.JOBS.getByName(tenant).wake(tenant)


class KovaJobs(DurableObject):
    def __init__(self, ctx, env):
        super().__init__(ctx, env)
        self._lock = asyncio.Lock()

    async def wake(self, tenant):
        if budget_paused(self.env):
            return False
        try:
            tenant = str(UUID(tenant))
        except (ValueError, TypeError, AttributeError):
            return False
        async with self._lock:
            initialize(self.env)
            from app.assistant.access import cohort

            if UUID(tenant) not in set(cohort()) | automation_cohort(self.env):
                return False
            stored = await self.ctx.storage.get("tenant")
            if stored is not None and stored != tenant:
                return False
            await self.ctx.storage.put("tenant", tenant)
            if await self.ctx.storage.getAlarm() is None:
                await self.ctx.storage.setAlarm(int(time.time() * 1000) + 1)
        return True

    async def alarm(self):
        if budget_paused(self.env):
            # Preserve queued work in Postgres; stop the durable retry loop.
            await self.ctx.storage.deleteAlarm()
            return
        from app.workers.context import environment, execution

        async with self._lock:
            env_token = environment.set(self.env)
            ctx_token = execution.set(self.ctx)
            try:
                initialize(self.env)
                from app.assistant.access import enabled
                from app.assistant.worker import process_once

                tenant = await self.ctx.storage.get("tenant")
                if tenant is None:
                    return
                tenant_id = UUID(tenant)
                assistant_allowed = enabled(tenant_id)
                automation_allowed = tenant_id in automation_cohort(self.env)
                if not assistant_allowed and not automation_allowed:
                    return
                # Persist recovery before I/O. One job per invocation, with
                # the existing leases, session checks and uncertain-call rules.
                await self.ctx.storage.setAlarm(int(time.time() * 1000) + 60_000)
                processed = 0
                if automation_allowed:
                    from app.automations.worker import process_tenant

                    processed += process_tenant(tenant_id, limit=50)
                if assistant_allowed:
                    processed += process_once(
                        workload="chat", tenant_id=tenant_id, maximum_jobs=1
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

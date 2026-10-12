"""Wake one existing file host. Never dispatch private content or create capacity."""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from functools import partial

import httpx
from sqlalchemy import and_, create_engine, or_, text
from sqlalchemy.orm import sessionmaker

from app.assistant import provider, storage
from app.assistant import repository as repo
from app.assistant.access import bind_user, cohort, enabled
from app.assistant.budget import reset_at
from app.assistant.models import AssistantRecord, now
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.config import settings, sqlalchemy_database_url
from app.db import SessionLocal, set_tenant_context

logger = logging.getLogger(__name__)


def configured():
    return bool(settings.assistant_ingest_machine_id and settings.assistant_ingest_fly_token)


def has_work(*, session_factory=None):
    """Metadata only, under the same tenant/user ACL and commercial gates as the worker."""
    if (not settings.assistant_enabled or not settings.assistant_documents_enabled
            or not storage.ready() or not provider.cloudflare_ready()):
        return False
    current = now()
    session_factory = session_factory or SessionLocal
    due = AssistantRecord.data["retry_at"].astext
    for tenant in cohort():
        if not enabled(tenant):
            continue
        with session_factory() as db:
            # A failed probe must not monopolize a connection used by the POS.
            db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
            set_tenant_context(db, tenant)
            if not get_billing_access_status(db, tenant_id=tenant).allowed:
                continue
            members = db.query(Membership).filter_by(tenant_id=tenant, is_active=True).all()
            for member in members:
                if member.role not in {"owner", "manager"} or member.allowed_branch_id is not None:
                    continue
                user = db.get(User, member.user_id)
                if not user or not user.is_active:
                    continue
                bind_user(db, user.id)
                pending = repo.records(db, tenant, user.id, "document").filter(or_(
                    AssistantRecord.status == "queued",
                    and_(AssistantRecord.status == "deferred", or_(
                        due <= current.isoformat(),
                        and_(due.is_(None), reset_at().isoformat() <= current.isoformat()),
                    )),
                    and_(AssistantRecord.status.in_(["running", "indexing"]),
                         AssistantRecord.updated_at < current - timedelta(minutes=11)),
                )).with_entities(AssistantRecord.id).first()
                # Empty queues cause no storage/provider/Fly requests. The
                # retirement tombstone is checked only before an eligible wake.
                if pending and not storage.tenant_deleted(tenant):
                    return True
    return False


async def wake(client):
    """No stop/update/create operation; refuse API/chat hosts or an unsafe restart policy."""
    if not configured():
        raise RuntimeError("Document dispatcher is not configured")
    path = ("/v1/apps/" + settings.fly_app_name + "/machines/"
            + settings.assistant_ingest_machine_id)
    response = await client.get(path)
    response.raise_for_status()
    machine = response.json()
    config = machine.get("config", {})
    guest = config.get("guest", {})
    if (machine.get("id") != settings.assistant_ingest_machine_id
            or config.get("metadata", {}).get("fly_process_group") != "ingest"
            or config.get("services") or machine.get("region") != "iad"
            or guest.get("cpu_kind") != "shared" or guest.get("cpus") != 4
            or guest.get("memory_mb") != 5120
            or config.get("restart", {}).get("policy") != "on-failure"):
        raise RuntimeError("Document host configuration is unsafe")
    if machine.get("state") in {"stopped", "suspended"}:
        response = await client.post(path + "/start")
        response.raise_for_status()
        logger.info("Document host wake accepted")
    # starting/stopping: the next sweep closes the enqueue/shutdown race.


async def supervise():
    # Separate, single-connection runtime pool: the dispatcher cannot borrow
    # one of the five connections reserved for admitted POS/API requests.
    engine = create_engine(sqlalchemy_database_url(settings.effective_app_database_url),
                           pool_size=1, max_overflow=0, pool_timeout=2, pool_pre_ping=True,
                           hide_parameters=True, connect_args={"connect_timeout": 3})
    probe = partial(has_work, session_factory=sessionmaker(bind=engine))
    try:
        await _supervise(probe)
    finally:
        engine.dispose()


async def _supervise(probe):
    # Dedicated thread: scanning never uses the request threadpool or chat worker.
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest-dispatch") as pool:
        async with httpx.AsyncClient(
            base_url="https://api.machines.dev", timeout=5, trust_env=False,
            headers={"Authorization": "Bearer " +
                     settings.assistant_ingest_fly_token.get_secret_value()},
        ) as client:
            while True:
                try:
                    if await asyncio.get_running_loop().run_in_executor(pool, probe):
                        await wake(client)
                except Exception:
                    # SQL/provider responses, credentials and Machine config stay private.
                    logger.error("Document dispatcher sweep failed; persisted jobs retained")
                await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app):
    task = None
    if settings.assistant_ingest_on_demand:
        if configured():
            task = asyncio.create_task(supervise())
        else:
            logger.error("Document dispatcher requires its Machine ID and app-scoped token")
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

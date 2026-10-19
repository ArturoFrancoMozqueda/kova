"""Retired document-host dispatcher; metadata probes remain reusable under ACLs.

Document ingestion stays postponed. Stale environment flags cannot start a host
or perform external I/O after permanent retirement of the previous provider.
"""

from contextlib import asynccontextmanager
from datetime import timedelta

from sqlalchemy import and_, or_, text

from app.assistant import provider, storage
from app.assistant import repository as repo
from app.assistant.access import bind_user, cohort, enabled
from app.assistant.budget import reset_at
from app.assistant.models import AssistantRecord, now
from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.config import settings
from app.db import SessionLocal, set_tenant_context


def configured():
    return False


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
                # Empty queues cause no storage/provider requests. The
                # retirement tombstone is checked only before an eligible wake.
                if pending and not storage.tenant_deleted(tenant):
                    return True
    return False


async def wake(client):
    raise RuntimeError("Document host provider retired; ingestion remains disabled")


async def supervise():
    raise RuntimeError("Document host provider retired; ingestion remains disabled")


@asynccontextmanager
async def lifespan(app):
    # Deliberately ignore old on-demand settings; no task, connection or timer.
    yield

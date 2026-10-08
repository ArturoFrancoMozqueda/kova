"""A separate runtime process. No privileged DB or tenant-agnostic content dispatch."""

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant import direct, documents, generation, notifications, provider, storage
from app.assistant import repository as repo
from app.assistant.access import bind_user, cohort, enabled
from app.assistant.budget import reset_at
from app.assistant.models import AssistantRecord, now
from app.auth.models import Membership, User, UserSession
from app.billing.access import get_billing_access_status
from app.branches.models import Branch
from app.branches.scope import bind_branch
from app.config import settings
from app.db import SessionLocal, set_tenant_context


def acquire(db, job):
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    db.execute(text("DELETE FROM assistant_control.slots WHERE expires_at<now()"))
    workload = "ingest" if job.kind == "document" else "chat"
    counts = db.execute(
        text("""SELECT count(*),count(*) FILTER (WHERE tenant_key=:tenant),
        count(*) FILTER (WHERE user_key=:user) FROM assistant_control.slots
        WHERE workload=:workload"""),
        {"tenant": job.tenant_id, "user": job.owner_user_id, "workload": workload},
    ).one()
    global_limit = (settings.assistant_ingest_global_concurrency if workload == "ingest"
                    else settings.assistant_global_concurrency)
    tenant_limit = 1 if workload == "ingest" else settings.assistant_tenant_concurrency
    if counts[0] >= global_limit or counts[1] >= tenant_limit or counts[2] >= 1:
        return False
    inserted = db.execute(
        text("""INSERT INTO assistant_control.slots(id,tenant_key,user_key,expires_at,workload)
        VALUES (:id,:tenant,:user,:expiry,:workload) ON CONFLICT DO NOTHING"""),
        {
            "id": job.id,
            "tenant": job.tenant_id,
            "user": job.owner_user_id,
            "expiry": now() + timedelta(minutes=11),
            "workload": workload,
        },
    )
    return inserted.rowcount == 1


def release(db, identifier):
    db.execute(text("DELETE FROM assistant_control.slots WHERE id=:id"), {"id": identifier})
    db.commit()


def process_job(db, user, member, candidate):
    job = repo.get(db, member.tenant_id, user.id, candidate.kind, candidate.id, lock=True)
    if job.status != "queued" or not acquire(db, job):
        db.rollback()
        return False
    session = db.get(UserSession, UUID(job.data["session_id"])) if job.kind == "run" else None
    if job.kind == "run" and (not session or session.revoked_at or session.expires_at <= now()):
        job.status = "cancelled"
        release(db, job.id)
        return False
    bind_branch(db, tenant_id=member.tenant_id, branch_id=job.branch_id)
    job.status = "running"
    job.updated_at = now()
    db.commit()
    try:
        if job.kind == "run":
            generation.run(db, (user, member, session), job)
        else:
            documents.ingest(db, (user, member, None), job)
    except Exception as exc:
        db.rollback()
        job = (
            repo.records(db, member.tenant_id, user.id, candidate.kind)
            .filter_by(id=candidate.id)
            .populate_existing()
            .with_for_update()
            .first()
        )
        if job is not None and job.status not in {"cancelled", "deleting"}:
            status = exc.status_code if isinstance(exc, HTTPException) else 503
            job.status = "deferred" if job.kind == "document" and status == 429 else "failed"
            if job.kind == "document" and status == 422:
                job.status = "quarantined"
                job.expires_at = now() + timedelta(days=1)
            if job.kind == "document" and job.data.get("embedding_started"):
                job.status = "failed"
            repo.update(
                job,
                error=exc.detail
                if isinstance(exc, HTTPException)
                else "No se pudo completar la ejecución.",
                error_code=status,
                retry_at=(now() + timedelta(seconds=int((exc.headers or {}).get(
                    "Retry-After", "60"
                )))).isoformat() if isinstance(exc, HTTPException) and status == 429
                else reset_at().isoformat(),
                limit_kind=(exc.headers or {}).get("X-Kova-Assistant-Limit")
                if isinstance(exc, HTTPException) else None,
            )
            db.commit()
    finally:
        release(db, candidate.id)
    return True


def cleanup(db, tenant, user):
    # Only expiration, without reading private content into a model or another admin.
    for expired in repo.records(db, tenant, user, "document").filter(
        AssistantRecord.expires_at < now()
    ):
        storage.delete(tenant, expired.id)
        db.delete(expired)
    for kind in ("conversation", "run", "message", "task", "mail"):
        query = repo.records(db, tenant, user, kind).filter(
            AssistantRecord.created_at < now() - timedelta(days=90)
        )
        # Conversation deletion cascades proposals; domain audit/idempotency survives.
        query.delete(synchronize_session=False)
    db.commit()


def process_once(*, workload="all") -> int:
    if workload not in {"all", "chat", "ingest"}:
        raise ValueError("invalid assistant workload")
    kinds = (("run", "document") if workload == "all"
             else ("document",) if workload == "ingest" else ("run",))
    processed = 0
    # Only shared quota metadata, never tenant content, is maintained globally.
    with SessionLocal() as control:
        cutoff = (now() - timedelta(days=30)).date().isoformat()
        control.execute(
            text("DELETE FROM assistant_control.budgets WHERE left(period_key,10)<:day"),
            {"day": cutoff},
        )
        control.execute(
            text("DELETE FROM assistant_control.allocations WHERE period_key<:day"), {"day": cutoff}
        )
        control.execute(text("DELETE FROM assistant_control.slots WHERE expires_at<now()"))
        control.commit()
    for tenant in cohort():
        if storage.tenant_deleted(tenant):
            continue
        with SessionLocal() as db:
            set_tenant_context(db, tenant)
            commercial = get_billing_access_status(db, tenant_id=tenant).allowed
            members = db.query(Membership).filter_by(tenant_id=tenant).all()
            for member in members:
                user = db.get(User, member.user_id)
                if not user:
                    continue
                bind_user(db, user.id)
                cleanup(db, tenant, user.id)
                if (
                    not enabled(tenant)
                    or not commercial
                    or not member.is_active
                    or not user.is_active
                    or member.role not in {"owner", "manager"}
                    or member.allowed_branch_id is not None
                ):
                    continue
                for kind in kinds:
                    for stale in repo.records(db, tenant, user.id, kind).filter(
                        AssistantRecord.status.in_(["running", "indexing"]),
                        AssistantRecord.updated_at < now() - timedelta(minutes=11),
                    ):
                        stale.status = "failed"
                        repo.update(
                            stale, error="La ejecución se interrumpió. Revisa antes de reintentar."
                        )
                for deferred in repo.records(db, tenant, user.id, "document").filter_by(
                    status="deferred"
                ) if "document" in kinds else ():
                    if deferred.data.get("retry_at", reset_at().isoformat()) <= now().isoformat():
                        deferred.status = "queued"
                db.commit()
                jobs = []
                for kind in kinds:
                    jobs += (
                        repo.records(db, tenant, user.id, kind)
                        .filter_by(status="queued")
                        .order_by(AssistantRecord.created_at)
                        .limit(3 if kind == "run" else 1)
                        .all()
                    )
                for job in jobs:
                    local = job.kind == "run" and direct.match(job.data.get("content", ""))
                    ready = ((provider.ready() or local) if job.kind == "run" else
                             (provider.cloudflare_ready() and storage.ready()
                              and settings.assistant_documents_enabled))
                    if not ready:
                        continue
                    processed += int(process_job(db, user, member, job))
                if workload == "ingest":
                    continue
                pref = repo.records(db, tenant, user.id, "preferences").populate_existing().first()
                if not pref:
                    continue
                last = pref.data.get("signals_at")
                event_at = db.execute(
                    text(
                        "SELECT happened_at FROM assistant_control.events WHERE tenant_key=:tenant"
                    ),
                    {"tenant": tenant},
                ).scalar()
                changed = (
                    event_at is not None
                    and (not last or event_at > datetime.fromisoformat(last))
                    and event_at <= now() - timedelta(minutes=5)
                )
                hourly = not last or now().isoformat()[:13] != last[:13]
                if changed or hourly:
                    for branch in db.query(Branch).filter_by(tenant_id=tenant):
                        bind_branch(db, tenant_id=tenant, branch_id=branch.id)
                        notifications.refresh_signals(db, (user, member, None), branch.id)
                    notifications.queue_digest(db, (user, member, None), tenant)
                    repo.update(pref, signals_at=now().isoformat())
                    db.commit()
                for candidate in (
                    repo.records(db, tenant, user.id, "mail").filter_by(status="queued").limit(5)
                ):
                    mail = repo.get(db, tenant, user.id, "mail", candidate.id, lock=True)
                    if mail.status == "queued":
                        notifications.deliver(db, (user, member, None), mail)
    return processed

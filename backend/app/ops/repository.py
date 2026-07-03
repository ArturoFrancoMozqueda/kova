"""Cross-tenant read queries and ops-table writes.

Every query here runs WITHOUT the ``app.tenant_id`` RLS GUC (cleared by
``require_internal_admin``) and relies on the app DB role owning the tables.
Never call these from tenant-facing code paths.
"""
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership, User, UserSession
from app.billing.models import Subscription, WebhookEvent
from app.onboarding.models import TenantOnboardingState
from app.ops.models import OpsIncidentState, OpsNote
from app.orders.models import Order
from app.telemetry.models import TelemetryEvent
from app.tenants.models import Tenant

_ACTIVE_STATUSES = ("active",)


def _now() -> datetime:
    return datetime.now(UTC)


# ── Money / revenue (subscriptions) ──────────────────────────────────────────


def subscription_status_counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(Subscription.status, func.count(Subscription.id))
        .group_by(Subscription.status)
        .all()
    )
    return {status: count for status, count in rows}


def mrr_minor_units(db: Session, *, statuses: tuple[str, ...] = _ACTIVE_STATUSES) -> int:
    total = (
        db.query(func.coalesce(func.sum(Subscription.amount_minor_units), 0))
        .filter(Subscription.status.in_(statuses))
        .scalar()
    )
    return int(total or 0)


def canceling_count(db: Session) -> int:
    return (
        db.query(func.count(Subscription.id))
        .filter(Subscription.status == "active", Subscription.cancel_at_period_end.is_(True))
        .scalar()
        or 0
    )


def trials_expiring_count(db: Session, *, within_days: int = 7) -> int:
    cutoff = _now() + timedelta(days=within_days)
    return (
        db.query(func.count(Subscription.id))
        .filter(
            Subscription.status == "trialing",
            Subscription.trial_ends_at.isnot(None),
            Subscription.trial_ends_at < cutoff,
        )
        .scalar()
        or 0
    )


def grace_period_expired_count(db: Session) -> int:
    now = _now()
    return (
        db.query(func.count(Subscription.id))
        .filter(
            Subscription.status == "past_due",
            Subscription.grace_period_ends_at.isnot(None),
            Subscription.grace_period_ends_at < now,
        )
        .scalar()
        or 0
    )


def list_subscriptions_by_status(
    db: Session, *, status: str, limit: int = 100
) -> list[tuple[Subscription, str]]:
    """Return (subscription, tenant_name) for a given status."""
    return (
        db.query(Subscription, Tenant.name)
        .join(Tenant, Tenant.id == Subscription.tenant_id)
        .filter(Subscription.status == status)
        .order_by(Subscription.updated_at.desc())
        .limit(limit)
        .all()
    )


# ── Webhook health ────────────────────────────────────────────────────────────


def failed_webhooks_count(db: Session, *, since: datetime) -> int:
    return (
        db.query(func.count(WebhookEvent.id))
        .filter(
            WebhookEvent.processing_status == "failed",
            WebhookEvent.created_at >= since,
        )
        .scalar()
        or 0
    )


def stuck_received_count(db: Session, *, older_than: datetime) -> int:
    return (
        db.query(func.count(WebhookEvent.id))
        .filter(
            WebhookEvent.processing_status == "received",
            WebhookEvent.created_at < older_than,
        )
        .scalar()
        or 0
    )


def last_webhook_at(db: Session) -> datetime | None:
    return db.query(func.max(WebhookEvent.created_at)).scalar()


def recent_failed_webhooks(db: Session, *, limit: int = 20) -> list[WebhookEvent]:
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.processing_status == "failed")
        .order_by(WebhookEvent.created_at.desc())
        .limit(limit)
        .all()
    )


def problem_webhooks(
    db: Session, *, stuck_older_than: datetime, limit: int = 100
) -> list[WebhookEvent]:
    """Failed events, plus 'received' events that never progressed (stuck)."""
    from sqlalchemy import and_, or_

    return (
        db.query(WebhookEvent)
        .filter(
            or_(
                WebhookEvent.processing_status == "failed",
                and_(
                    WebhookEvent.processing_status == "received",
                    WebhookEvent.created_at < stuck_older_than,
                ),
            )
        )
        .order_by(WebhookEvent.created_at.desc())
        .limit(limit)
        .all()
    )


def get_webhook_by_event_id(db: Session, stripe_event_id: str) -> WebhookEvent | None:
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.stripe_event_id == stripe_event_id)
        .first()
    )


def get_subscription_by_tenant(db: Session, tenant_id: UUID) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()


# ── Incident triage state ─────────────────────────────────────────────────────


def incident_states_map(
    db: Session, keys: list[tuple[str, str]]
) -> dict[tuple[str, str], OpsIncidentState]:
    """Fetch triage rows for a set of (source, external_id) natural keys."""
    if not keys:
        return {}
    sources = {k[0] for k in keys}
    externals = {k[1] for k in keys}
    rows = (
        db.query(OpsIncidentState)
        .filter(
            OpsIncidentState.source.in_(sources),
            OpsIncidentState.external_id.in_(externals),
        )
        .all()
    )
    wanted = set(keys)
    return {
        (row.source, row.external_id): row
        for row in rows
        if (row.source, row.external_id) in wanted
    }


def get_incident_state(
    db: Session, *, source: str, external_id: str
) -> OpsIncidentState | None:
    return (
        db.query(OpsIncidentState)
        .filter(
            OpsIncidentState.source == source,
            OpsIncidentState.external_id == external_id,
        )
        .first()
    )


def upsert_incident_state(
    db: Session,
    *,
    source: str,
    external_id: str,
    triage_status: str | None,
    snoozed_until: datetime | None,
    updated_by_user_id: UUID,
) -> OpsIncidentState:
    state = get_incident_state(db, source=source, external_id=external_id)
    if state is None:
        state = OpsIncidentState(source=source, external_id=external_id)
        db.add(state)
    if triage_status is not None:
        state.triage_status = triage_status
    if snoozed_until is not None:
        state.snoozed_until = snoozed_until
    state.updated_by_user_id = updated_by_user_id
    state.updated_at = _now()
    db.flush()
    return state


# ── Trace (cross-source correlation, local DB) ────────────────────────────────


def trace_webhook_events(
    db: Session,
    *,
    stripe_event_id: str | None,
    tenant_id: UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[WebhookEvent]:
    query = db.query(WebhookEvent)
    if stripe_event_id:
        query = query.filter(WebhookEvent.stripe_event_id == stripe_event_id)
    if tenant_id:
        query = query.filter(WebhookEvent.tenant_id == tenant_id)
    query = _time_filter(query, WebhookEvent.created_at, from_ts, to_ts)
    return query.order_by(WebhookEvent.created_at.desc()).limit(limit).all()


def trace_telemetry(
    db: Session,
    *,
    tenant_id: UUID | None,
    user_id: UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[TelemetryEvent]:
    if not (tenant_id or user_id):
        return []
    query = db.query(TelemetryEvent)
    if tenant_id:
        query = query.filter(TelemetryEvent.tenant_id == tenant_id)
    if user_id:
        query = query.filter(TelemetryEvent.user_id == user_id)
    query = _time_filter(query, TelemetryEvent.created_at, from_ts, to_ts)
    return query.order_by(TelemetryEvent.created_at.desc()).limit(limit).all()


def trace_orders(
    db: Session,
    *,
    tenant_id: UUID | None,
    user_id: UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[Order]:
    if not (tenant_id or user_id):
        return []
    query = db.query(Order)
    if tenant_id:
        query = query.filter(Order.tenant_id == tenant_id)
    if user_id:
        query = query.filter(Order.created_by_user_id == user_id)
    query = _time_filter(query, Order.created_at, from_ts, to_ts)
    return query.order_by(Order.created_at.desc()).limit(limit).all()


def trace_audit_logs(
    db: Session,
    *,
    tenant_id: UUID | None,
    user_id: UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[AuditLog]:
    if not (tenant_id or user_id):
        return []
    query = db.query(AuditLog)
    if tenant_id:
        query = query.filter(AuditLog.tenant_id == tenant_id)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    query = _time_filter(query, AuditLog.created_at, from_ts, to_ts)
    return query.order_by(AuditLog.created_at.desc()).limit(limit).all()


def trace_sessions(
    db: Session,
    *,
    tenant_id: UUID | None,
    user_id: UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    limit: int,
) -> list[UserSession]:
    if not (tenant_id or user_id):
        return []
    query = db.query(UserSession)
    if tenant_id:
        query = query.filter(UserSession.tenant_id == tenant_id)
    if user_id:
        query = query.filter(UserSession.user_id == user_id)
    query = _time_filter(query, UserSession.created_at, from_ts, to_ts)
    return query.order_by(UserSession.created_at.desc()).limit(limit).all()


def _time_filter(query, column, from_ts: datetime | None, to_ts: datetime | None):
    if from_ts:
        query = query.filter(column >= from_ts)
    if to_ts:
        query = query.filter(column <= to_ts)
    return query


# ── Operations (orders / signups) ────────────────────────────────────────────


def orders_summary(db: Session, *, since: datetime) -> tuple[int, Decimal]:
    """(#completed orders, total sales amount) since a cutoff, across tenants."""
    count, total = (
        db.query(
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .filter(Order.status == "completed", Order.created_at >= since)
        .one()
    )
    return int(count or 0), Decimal(total or 0)


def signups_count(db: Session, *, since: datetime) -> int:
    return (
        db.query(func.count(Tenant.id)).filter(Tenant.created_at >= since).scalar() or 0
    )


def active_tenants_count(db: Session, *, since: datetime) -> int:
    return (
        db.query(func.count(func.distinct(Order.tenant_id)))
        .filter(Order.status == "completed", Order.created_at >= since)
        .scalar()
        or 0
    )


def past_due_tenants_count(db: Session) -> int:
    return (
        db.query(func.count(Subscription.id))
        .filter(Subscription.status == "past_due")
        .scalar()
        or 0
    )


# ── Funnel ────────────────────────────────────────────────────────────────────


def _telemetry_tenants_with_event(
    db: Session, *, event_name: str, tenant_ids: list[UUID]
) -> set[UUID]:
    if not tenant_ids:
        return set()
    rows = (
        db.query(func.distinct(TelemetryEvent.tenant_id))
        .filter(
            TelemetryEvent.event_name == event_name,
            TelemetryEvent.tenant_id.in_(tenant_ids),
        )
        .all()
    )
    return {row[0] for row in rows}


def _onboarding_tenants_with_flag(
    db: Session, *, column, tenant_ids: list[UUID]
) -> set[UUID]:
    if not tenant_ids:
        return set()
    rows = (
        db.query(TenantOnboardingState.tenant_id)
        .filter(
            column.is_(True),
            TenantOnboardingState.tenant_id.in_(tenant_ids),
        )
        .all()
    )
    return {row[0] for row in rows}


def cohort_tenant_ids(db: Session, *, since: datetime) -> list[UUID]:
    rows = db.query(Tenant.id).filter(Tenant.created_at >= since).all()
    return [row[0] for row in rows]


def verified_owner_tenant_ids(db: Session, *, tenant_ids: list[UUID]) -> set[UUID]:
    if not tenant_ids:
        return set()
    rows = (
        db.query(func.distinct(Membership.tenant_id))
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id.in_(tenant_ids),
            Membership.role == "owner",
            User.is_email_verified.is_(True),
        )
        .all()
    )
    return {row[0] for row in rows}


# ── Tenants overview ──────────────────────────────────────────────────────────


def list_tenants(
    db: Session, *, search: str | None = None, offset: int = 0, limit: int = 50
) -> tuple[list[Tenant], int]:
    query = db.query(Tenant)
    if search:
        like = f"%{search.lower()}%"
        query = query.filter(func.lower(Tenant.name).like(like))
    total = query.count()
    tenants = (
        query.order_by(Tenant.created_at.desc()).offset(offset).limit(limit).all()
    )
    return tenants, total


def subscriptions_by_tenant(
    db: Session, *, tenant_ids: list[UUID]
) -> dict[UUID, Subscription]:
    if not tenant_ids:
        return {}
    rows = db.query(Subscription).filter(Subscription.tenant_id.in_(tenant_ids)).all()
    return {row.tenant_id: row for row in rows}


def onboarding_by_tenant(
    db: Session, *, tenant_ids: list[UUID]
) -> dict[UUID, TenantOnboardingState]:
    if not tenant_ids:
        return {}
    rows = (
        db.query(TenantOnboardingState)
        .filter(TenantOnboardingState.tenant_id.in_(tenant_ids))
        .all()
    )
    return {row.tenant_id: row for row in rows}


def owner_emails_by_tenant(db: Session, *, tenant_ids: list[UUID]) -> dict[UUID, str]:
    if not tenant_ids:
        return {}
    rows = (
        db.query(Membership.tenant_id, User.email)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.tenant_id.in_(tenant_ids), Membership.role == "owner")
        .all()
    )
    # A tenant should have exactly one owner; if not, first wins deterministically.
    result: dict[UUID, str] = {}
    for tenant_id, email in rows:
        result.setdefault(tenant_id, email)
    return result


def users_count_by_tenant(db: Session, *, tenant_ids: list[UUID]) -> dict[UUID, int]:
    if not tenant_ids:
        return {}
    rows = (
        db.query(Membership.tenant_id, func.count(Membership.id))
        .filter(Membership.tenant_id.in_(tenant_ids), Membership.is_active.is_(True))
        .group_by(Membership.tenant_id)
        .all()
    )
    return {tenant_id: count for tenant_id, count in rows}


def order_activity_by_tenant(
    db: Session, *, tenant_ids: list[UUID], since_7d: datetime, since_30d: datetime
) -> dict[UUID, dict]:
    """Per-tenant order counts (7d/30d) and last completed order timestamp."""
    if not tenant_ids:
        return {}
    result: dict[UUID, dict] = {
        tid: {"orders_7d": 0, "orders_30d": 0, "last_order_at": None} for tid in tenant_ids
    }

    rows_30 = (
        db.query(Order.tenant_id, func.count(Order.id))
        .filter(
            Order.tenant_id.in_(tenant_ids),
            Order.status == "completed",
            Order.created_at >= since_30d,
        )
        .group_by(Order.tenant_id)
        .all()
    )
    for tenant_id, count in rows_30:
        result[tenant_id]["orders_30d"] = count

    rows_7 = (
        db.query(Order.tenant_id, func.count(Order.id))
        .filter(
            Order.tenant_id.in_(tenant_ids),
            Order.status == "completed",
            Order.created_at >= since_7d,
        )
        .group_by(Order.tenant_id)
        .all()
    )
    for tenant_id, count in rows_7:
        result[tenant_id]["orders_7d"] = count

    rows_last = (
        db.query(Order.tenant_id, func.max(Order.created_at))
        .filter(Order.tenant_id.in_(tenant_ids), Order.status == "completed")
        .group_by(Order.tenant_id)
        .all()
    )
    for tenant_id, last_at in rows_last:
        result[tenant_id]["last_order_at"] = last_at

    return result


# ── Notes ───────────────────────────────────────────────────────────────────


def list_notes(
    db: Session,
    *,
    entity_type: str | None = None,
    entity_source: str | None = None,
    entity_external_id: str | None = None,
    tenant_id: UUID | None = None,
    status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[tuple[OpsNote, str]], int]:
    query = db.query(OpsNote, User.email).join(User, User.id == OpsNote.author_user_id)
    if entity_type is not None:
        query = query.filter(OpsNote.entity_type == entity_type)
    if entity_source is not None:
        query = query.filter(OpsNote.entity_source == entity_source)
    if entity_external_id is not None:
        query = query.filter(OpsNote.entity_external_id == entity_external_id)
    if tenant_id is not None:
        query = query.filter(OpsNote.tenant_id == tenant_id)
    if status is not None:
        query = query.filter(OpsNote.status == status)
    total = query.count()
    rows = (
        query.order_by(OpsNote.pinned.desc(), OpsNote.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return rows, total


def create_note(
    db: Session,
    *,
    author_user_id: UUID,
    entity_type: str,
    entity_source: str | None,
    entity_external_id: str | None,
    tenant_id: UUID | None,
    body: str,
) -> OpsNote:
    note = OpsNote(
        author_user_id=author_user_id,
        entity_type=entity_type,
        entity_source=entity_source,
        entity_external_id=entity_external_id,
        tenant_id=tenant_id,
        body=body,
    )
    db.add(note)
    db.flush()
    return note


def get_note(db: Session, note_id: UUID) -> OpsNote | None:
    return db.query(OpsNote).filter(OpsNote.id == note_id).first()


def update_note(
    db: Session,
    note: OpsNote,
    *,
    body: str | None = None,
    status: str | None = None,
    pinned: bool | None = None,
) -> OpsNote:
    if body is not None:
        note.body = body
    if status is not None:
        note.status = status
    if pinned is not None:
        note.pinned = pinned
    note.updated_at = _now()
    db.flush()
    return note

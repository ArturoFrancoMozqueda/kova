"""Internal ops tables — NOT tenant-scoped, so no RLS (same as audit_logs and
webhook_events). Reachable only through the internal-admin endpoints.

Incidents themselves are computed on read from their sources of truth
(webhook_events, subscriptions, external APIs); only the human triage state is
persisted here, keyed by the incident's natural key (source, external_id).
"""
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

NOTE_ENTITY_TYPES = ("incident", "tenant", "general")
NOTE_STATUSES = ("open", "resolved", "archived")
INCIDENT_SOURCES = (
    "stripe_webhook",
    "subscription",
    "sentry",
    "uptimerobot",
    "fly",
    "vercel",
    "db",
)
TRIAGE_STATUSES = ("new", "acknowledged", "investigating", "resolved", "ignored")


def _now() -> datetime:
    return datetime.now(UTC)


class OpsNote(Base):
    __tablename__ = "ops_notes"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ('incident','tenant','general')",
            name="ck_ops_notes_entity_type",
        ),
        CheckConstraint(
            "status IN ('open','resolved','archived')",
            name="ck_ops_notes_status",
        ),
        Index("ix_ops_notes_entity", "entity_type", "entity_source", "entity_external_id"),
        Index("ix_ops_notes_tenant_id", "tenant_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    author_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tenant_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class OpsIncidentState(Base):
    __tablename__ = "ops_incident_states"
    __table_args__ = (
        CheckConstraint(
            "source IN ('stripe_webhook','subscription','sentry',"
            "'uptimerobot','fly','vercel','db')",
            name="ck_ops_incident_states_source",
        ),
        CheckConstraint(
            "triage_status IN ('new','acknowledged','investigating','resolved','ignored')",
            name="ck_ops_incident_states_triage",
        ),
        UniqueConstraint("source", "external_id", name="uq_ops_incident_states_source_external"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    triage_status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")
    snoozed_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

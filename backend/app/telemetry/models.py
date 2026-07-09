from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"
    __table_args__ = (
        UniqueConstraint("tenant_id", "client_event_id", name="uq_telemetry_tenant_client_event"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    event_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    client_event_id: Mapped[str] = mapped_column(String(80), nullable=False)
    properties: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )


class AnonymousTelemetryEvent(Base):
    """Pre-authentication funnel events (landing page-view, CTA click, signup
    start), keyed only by the client-generated ``client_id``.

    Deliberately a **separate** table from :class:`TelemetryEvent`: it carries no
    ``tenant_id``/``user_id`` and no FK to the tenanted schema, so a visitor with
    no session can write to it without weakening the authenticated, tenant-scoped
    telemetry path. The same ``client_id`` links a pre-auth row here to the later
    authenticated ``signup_completed`` event downstream (dedupe by ``client_id``).
    Never store PII here — only ``client_id`` + event type + coarse metadata.
    """

    __tablename__ = "anonymous_telemetry_events"
    __table_args__ = (
        UniqueConstraint("client_event_id", name="uq_anon_telemetry_client_event"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    event_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    client_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    client_event_id: Mapped[str] = mapped_column(String(80), nullable=False)
    properties: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

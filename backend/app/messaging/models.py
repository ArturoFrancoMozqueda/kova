"""Private channel metadata and immutable-content delivery ledger; never credentials."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


def now():
    return datetime.now(UTC)


class ChannelBinding(BranchScoped, Base):
    __tablename__ = "messaging_channel_bindings"
    __table_args__ = (
        UniqueConstraint("phone_number_id", name="uq_messaging_binding_phone"),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_binding_owner"),
        UniqueConstraint("tenant_id", "branch_id", name="uq_messaging_binding_branch"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    waba_id: Mapped[str] = mapped_column(String(32), nullable=False)
    phone_number_id: Mapped[str] = mapped_column(String(32), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Conversation(BranchScoped, Base):
    __tablename__ = "messaging_conversations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_conversation_owner"),
        UniqueConstraint("binding_id", "external_party", name="uq_messaging_conversation_party"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "binding_id"],
            [
                "messaging_channel_bindings.tenant_id",
                "messaging_channel_bindings.branch_id",
                "messaging_channel_bindings.id",
            ],
        ),
        CheckConstraint(
            "status IN ('open','closed') AND origin IN ('manual','whatsapp') AND version >= 1",
            name="ck_messaging_conversation_state",
        ),
        CheckConstraint(
            "(origin='whatsapp') = (binding_id IS NOT NULL AND external_party IS NOT NULL)",
            name="ck_messaging_conversation_origin",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID | None] = mapped_column()
    binding_id: Mapped[UUID | None] = mapped_column()
    external_party: Mapped[str | None] = mapped_column(String(256))
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
    automation_paused: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    assigned_user_id: Mapped[UUID | None] = mapped_column()
    last_inbound_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Message(BranchScoped, Base):
    __tablename__ = "messaging_messages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_message_owner"),
        UniqueConstraint("binding_id", "provider_message_id", name="uq_messaging_provider_message"),
        UniqueConstraint("source_run_id", name="uq_messaging_source_run"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "source_run_id"],
            ["automation_runs.tenant_id", "automation_runs.branch_id", "automation_runs.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "conversation_id"],
            [
                "messaging_conversations.tenant_id",
                "messaging_conversations.branch_id",
                "messaging_conversations.id",
            ],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "binding_id"],
            [
                "messaging_channel_bindings.tenant_id",
                "messaging_channel_bindings.branch_id",
                "messaging_channel_bindings.id",
            ],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "requested_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint(
            "direction IN ('inbound','outbound') AND version >= 1",
            name="ck_messaging_message_direction",
        ),
        CheckConstraint(
            "purpose IS NULL OR purpose IN ('transactional','marketing')",
            name="ck_messaging_message_purpose",
        ),
        CheckConstraint(
            "state IN ('received','draft','queued','sending','accepted','sent',"
            "'delivered','read','failed','uncertain','cancelled','suppressed')",
            name="ck_messaging_message_state",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    conversation_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    binding_id: Mapped[UUID | None] = mapped_column()
    source_run_id: Mapped[UUID | None] = mapped_column()
    provider_message_id: Mapped[str | None] = mapped_column(String(510))
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    body: Mapped[str | None] = mapped_column(String(4096))
    message_type: Mapped[str] = mapped_column(String(40), nullable=False, default="text")
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    purpose: Mapped[str | None] = mapped_column(String(24))
    requested_by_user_id: Mapped[UUID | None] = mapped_column()
    contact_fingerprint: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ChannelEventRecord(BranchScoped, Base):
    __tablename__ = "messaging_channel_events"
    __table_args__ = (
        UniqueConstraint("binding_id", "dedupe_key", name="uq_messaging_event_dedupe"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "binding_id"],
            [
                "messaging_channel_bindings.tenant_id",
                "messaging_channel_bindings.branch_id",
                "messaging_channel_bindings.id",
            ],
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    binding_id: Mapped[UUID] = mapped_column(nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_message_id: Mapped[str] = mapped_column(String(510), nullable=False)
    status: Mapped[str | None] = mapped_column(String(16))
    recipient: Mapped[str | None] = mapped_column(String(256))
    happened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

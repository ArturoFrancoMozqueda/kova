"""Durable assistant resources. Private by default, even between tenant admins."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from app.db import Base

KINDS = (
    "conversation",
    "message",
    "run",
    "proposal",
    "document",
    "memory",
    "goal",
    "task",
    "preferences",
    "mail",
    "reservation",
)


def now() -> datetime:
    return datetime.now(UTC)


class AssistantRecord(Base):
    __tablename__ = "assistant_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "owner_user_id", "kind", "dedupe_key"),
        ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(
            ["tenant_id", "parent_id"],
            ["assistant_records.tenant_id", "assistant_records.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        CheckConstraint("kind IN (" + ",".join(repr(k) for k in KINDS) + ")"),
        CheckConstraint("NOT shared OR kind IN ('document', 'memory', 'goal')"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    owner_user_id: Mapped[UUID] = mapped_column(index=True)
    branch_id: Mapped[UUID] = mapped_column()
    parent_id: Mapped[UUID | None] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    status: Mapped[str] = mapped_column(String(32), default="ready", index=True)
    shared: Mapped[bool] = mapped_column(default=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(160))
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Vector(UserDefinedType):
    cache_ok = True

    def bind_processor(self, dialect):
        import json

        return lambda value: None if value is None else json.dumps(value)

    def get_col_spec(self, **kw):
        return "extensions.vector(1024)"


class AssistantChunk(Base):
    __tablename__ = "assistant_chunks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "document_id"],
            ["assistant_records.tenant_id", "assistant_records.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("tenant_id", "document_id", "position"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    document_id: Mapped[UUID] = mapped_column(index=True)
    position: Mapped[int] = mapped_column()
    page: Mapped[int] = mapped_column()
    content: Mapped[str] = mapped_column()
    embedding: Mapped[object | None] = mapped_column(Vector(), nullable=True)

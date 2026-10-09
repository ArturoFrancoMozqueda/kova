from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


def now() -> datetime:
    return datetime.now(UTC)


class DrawerDevice(BranchScoped, Base):
    __tablename__ = "drawer_devices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", name="uq_drawer_device_branch"),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_drawer_device_owner"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        CheckConstraint("pin IN (0, 1)", name="ck_drawer_device_pin"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100))
    pin: Mapped[int] = mapped_column(default=0)
    auto_open: Mapped[bool] = mapped_column(Boolean, default=False)
    pairing_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pairing_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    key_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DrawerCommand(BranchScoped, Base):
    __tablename__ = "drawer_commands"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "device_id"],
            ["drawer_devices.tenant_id", "drawer_devices.branch_id", "drawer_devices.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        UniqueConstraint("tenant_id", "branch_id", "request_key", name="uq_drawer_command_request"),
        CheckConstraint("kind IN ('sale', 'manual', 'test')", name="ck_drawer_command_kind"),
        CheckConstraint(
            "status IN ('pending', 'dispatched', 'sent', 'failed', 'expired')",
            name="ck_drawer_command_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    device_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    request_key: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(10))
    order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    requested_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    reason: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

"""Private customer service workflow with append-only author-attributed events."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
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


class ServiceCase(BranchScoped, Base):
    __tablename__ = "service_cases"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_service_case_owner"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("version >= 1", name="ck_service_case_version"),
        CheckConstraint(
            "(status IN ('resolved','cancelled')) = (resolved_at IS NOT NULL)",
            name="ck_service_case_resolution",
        ),
        CheckConstraint(
            "status IN ('open','in_progress','resolved','reopened','cancelled')",
            name="ck_service_case_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    sale_order_id: Mapped[UUID | None] = mapped_column()
    customer_order_id: Mapped[UUID | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    assigned_user_id: Mapped[UUID | None] = mapped_column()
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=now
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ServiceCaseEvent(BranchScoped, Base):
    __tablename__ = "service_case_events"
    __table_args__ = (
        UniqueConstraint("case_id", "case_version", name="uq_service_case_event_version"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "case_id"],
            ["service_cases.tenant_id", "service_cases.branch_id", "service_cases.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("case_version >= 1", name="ck_service_case_event_version"),
        CheckConstraint(
            "kind IN ('created','updated','note_added')", name="ck_service_case_event_kind"
        ),
        CheckConstraint(
            "status IN ('open','in_progress','resolved','reopened','cancelled')",
            name="ck_service_case_event_status",
        ),
        CheckConstraint(
            "(kind = 'updated' AND note IS NULL) OR (kind != 'updated' AND note IS NOT NULL)",
            name="ck_service_case_event_note",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    case_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    case_version: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    assigned_user_id: Mapped[UUID | None] = mapped_column()
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=now
    )

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


class AppointmentResource(BranchScoped, Base):
    __tablename__ = "appointment_resources"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_appointment_resource_owner"),
        UniqueConstraint("tenant_id", "branch_id", "name", name="uq_appointment_resource_name"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        CheckConstraint("version >= 1", name="ck_appointment_resource_version"),
        CheckConstraint(
            "timezone IN ('America/Mexico_City','America/Cancun','America/Tijuana',"
            "'America/Hermosillo','America/Mazatlan','America/Monterrey')",
            name="ck_appointment_resource_timezone",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(48), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Appointment(BranchScoped, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_appointment_owner"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint(
            "version >= 1 AND ends_at > starts_at AND ends_at <= starts_at + interval '24 hours'",
            name="ck_appointment_interval",
        ),
        CheckConstraint(
            "status IN ('scheduled','cancelled','completed','no_show')",
            name="ck_appointment_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    resource_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AppointmentHistory(BranchScoped, Base):
    __tablename__ = "appointment_history"
    __table_args__ = (
        UniqueConstraint(
            "appointment_id", "appointment_version", name="uq_appointment_history_version"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.branch_id", "appointments.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("appointment_version >= 1", name="ck_appointment_history_version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    appointment_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    appointment_version: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(String(1000))
    actor_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AppointmentReminder(BranchScoped, Base):
    __tablename__ = "appointment_reminders"
    __table_args__ = (
        UniqueConstraint(
            "appointment_id", "appointment_version", name="uq_appointment_reminder_version"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.branch_id", "appointments.id"],
        ),
        CheckConstraint(
            "appointment_version >= 1 AND version >= 1", name="ck_appointment_reminder_version"
        ),
        CheckConstraint(
            "status IN ('pending','completed','dismissed','suppressed')",
            name="ck_appointment_reminder_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    appointment_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    appointment_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.orm_metadata import Base


def now():
    return datetime.now(UTC)


class BookingPage(BranchScoped, Base):
    __tablename__ = "booking_pages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    link_version: Mapped[int] = mapped_column(Integer, default=1)
    horizon_days: Mapped[int] = mapped_column(Integer, default=30)
    notice_minutes: Mapped[int] = mapped_column(Integer, default=120)
    slot_minutes: Mapped[int] = mapped_column(Integer, default=15)
    manage_cutoff_hours: Mapped[int] = mapped_column(Integer, default=24)
    authorized_by_user_id: Mapped[UUID] = mapped_column()
    mode: Mapped[str] = mapped_column(
        String(16), default="appointments", server_default="appointments"
    )


class BookingService(BranchScoped, Base):
    __tablename__ = "booking_services"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(String(500), default="")
    duration_minutes: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class BookingServiceResource(BranchScoped, Base):
    __tablename__ = "booking_service_resources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "service_id"],
            ["booking_services.tenant_id", "booking_services.branch_id", "booking_services.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
        UniqueConstraint("tenant_id", "branch_id", "service_id", "resource_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    service_id: Mapped[UUID] = mapped_column()
    resource_id: Mapped[UUID] = mapped_column()


class BookingAvailability(BranchScoped, Base):
    __tablename__ = "booking_availability"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "resource_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    resource_id: Mapped[UUID] = mapped_column()
    weekly: Mapped[list] = mapped_column(JSONB, default=list)
    exceptions: Mapped[list] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)


class PublicBooking(BranchScoped, Base):
    __tablename__ = "public_bookings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id"),
        UniqueConstraint("operation_hash"),
        UniqueConstraint("appointment_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "service_id"],
            ["booking_services.tenant_id", "booking_services.branch_id", "booking_services.id"],
        ),
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
            ["tenant_id", "branch_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.branch_id", "appointments.id"],
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    service_id: Mapped[UUID] = mapped_column()
    resource_id: Mapped[UUID] = mapped_column(index=True)
    customer_id: Mapped[UUID | None] = mapped_column()
    appointment_id: Mapped[UUID | None] = mapped_column()
    guest_name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(160))
    timezone: Mapped[str] = mapped_column(String(48))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    version: Mapped[int] = mapped_column(Integer, default=1)
    manage_version: Mapped[int] = mapped_column(Integer, default=1)
    operation_hash: Mapped[str] = mapped_column(String(64))
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class BookingHistory(BranchScoped, Base):
    __tablename__ = "booking_history"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "booking_id"],
            ["public_bookings.tenant_id", "public_bookings.branch_id", "public_bookings.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        UniqueConstraint("booking_id", "version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    booking_id: Mapped[UUID] = mapped_column()
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(32))
    actor_user_id: Mapped[UUID | None] = mapped_column()
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    status: Mapped[str] = mapped_column(String(16))
    details: Mapped[str] = mapped_column(Text, default="")


class TableReservation(BranchScoped, Base):
    __tablename__ = "table_reservations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id"),
        UniqueConstraint("operation_hash"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    resource_id: Mapped[UUID | None] = mapped_column()
    customer_id: Mapped[UUID | None] = mapped_column()
    guest_name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(30))
    party_size: Mapped[int] = mapped_column(Integer)
    timezone: Mapped[str] = mapped_column(String(48))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(16), default="requested")
    version: Mapped[int] = mapped_column(Integer, default=1)
    manage_version: Mapped[int] = mapped_column(Integer, default=1)
    operation_hash: Mapped[str] = mapped_column(String(64))
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    seated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TableReservationHistory(BranchScoped, Base):
    __tablename__ = "table_reservation_history"
    __table_args__ = (
        UniqueConstraint("reservation_id", "version"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "reservation_id"],
            [
                "table_reservations.tenant_id",
                "table_reservations.branch_id",
                "table_reservations.id",
            ],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(index=True)
    reservation_id: Mapped[UUID] = mapped_column()
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(32))
    actor_user_id: Mapped[UUID | None] = mapped_column()
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resource_id: Mapped[UUID | None] = mapped_column()
    status: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

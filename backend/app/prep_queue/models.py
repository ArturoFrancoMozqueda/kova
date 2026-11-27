from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.orm_metadata import Base


def _now() -> datetime:
    return datetime.now(UTC)


class PrepStation(Base):
    """Where products are prepared (Barra, Cocina); shared by the business's branches."""

    __tablename__ = "prep_stations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_prep_stations_tenant_id"),
        CheckConstraint("alert_minutes BETWEEN 1 AND 240", name="ck_prep_stations_alert"),
        CheckConstraint("length(btrim(name)) > 0", name="ck_prep_stations_name"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # Minutes before a ticket shows as late.
    alert_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class PrepDailyNumber(BranchScoped, Base):
    """Last short number handed out per branch and local day (#1, #2...)."""

    __tablename__ = "prep_daily_numbers"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_prep_daily_numbers_branch",
        ),
        CheckConstraint("last_number > 0", name="ck_prep_daily_numbers_positive"),
    )

    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    branch_id: Mapped[UUID] = mapped_column(primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False)


class PrepTicket(BranchScoped, Base):
    """One station's work for one counter sale."""

    __tablename__ = "prep_tickets"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_prep_tickets_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_prep_tickets_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "station_id"],
            ["prep_stations.tenant_id", "prep_stations.id"],
            name="fk_prep_tickets_station",
        ),
        UniqueConstraint("order_id", "station_id", name="uq_prep_tickets_order_station"),
        CheckConstraint(
            "status IN ('received', 'preparing', 'ready', 'delivered', 'cancelled')",
            name="ck_prep_tickets_status",
        ),
        CheckConstraint("number > 0", name="ck_prep_tickets_number"),
        Index("ix_prep_tickets_open", "tenant_id", "branch_id", "status", "received_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    station_id: Mapped[UUID] = mapped_column(nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="received")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    preparing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

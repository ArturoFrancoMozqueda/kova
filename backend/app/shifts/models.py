from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    DateTime,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Shift(BranchScoped, Base):
    __tablename__ = "shifts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_shifts_tenant_branch_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_shifts_branch",
        ),
        # At most one open shift per branch, including concurrent opens.
        Index(
            "uq_one_open_shift_per_branch",
            "tenant_id",
            "branch_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
        UniqueConstraint("tenant_id", "id", name="uq_shifts_tenant_id_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    opened_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    closed_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    opening_cash_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    actual_cash_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    expected_cash_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    reconciliation_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    variance_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CashMovement(BranchScoped, Base):
    __tablename__ = "cash_movements"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_cash_movements_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "shift_id"],
            ["shifts.tenant_id", "shifts.branch_id", "shifts.id"],
            name="fk_cash_movements_tenant_shift",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    shift_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

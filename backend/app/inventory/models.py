from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


class InventoryLot(Base):
    __tablename__ = "inventory_lots"
    __table_args__ = (
        UniqueConstraint("tenant_id", "product_id", "id", name="uq_lots_owner_product"),
        UniqueConstraint("tenant_id", "product_id", "code", name="uq_lots_code"),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    is_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manufactured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    rotation_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    rotation_label: Mapped[str] = mapped_column(
        String(24), nullable=False, default="consumo_preferente"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class InventoryLotAllocation(BranchScoped, Base):
    __tablename__ = "inventory_lot_allocations"
    __table_args__ = (
        UniqueConstraint("movement_id", "lot_id", name="uq_lot_movement"),
        ForeignKeyConstraint(
            ["tenant_id", "product_id", "lot_id"],
            ["inventory_lots.tenant_id", "inventory_lots.product_id", "inventory_lots.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "product_id", "movement_id"],
            [
                "inventory_movements.tenant_id",
                "inventory_movements.branch_id",
                "inventory_movements.product_id",
                "inventory_movements.id",
            ],
        ),
        CheckConstraint("quantity_delta <> 0", name="ck_lot_delta"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    movement_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    lot_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)


class InventoryLotReservation(BranchScoped, Base):
    __tablename__ = "inventory_lot_reservations"
    __table_args__ = (
        UniqueConstraint("reservation_id", "lot_id", name="uq_lot_reservation"),
        ForeignKeyConstraint(
            ["tenant_id", "product_id", "lot_id"],
            ["inventory_lots.tenant_id", "inventory_lots.product_id", "inventory_lots.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "product_id", "reservation_id"],
            [
                "inventory_reservations.tenant_id",
                "inventory_reservations.branch_id",
                "inventory_reservations.product_id",
                "inventory_reservations.id",
            ],
        ),
        CheckConstraint("quantity > 0", name="ck_lot_reserved_quantity"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    reservation_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    lot_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

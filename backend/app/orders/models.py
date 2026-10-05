from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Order(BranchScoped, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_orders_tenant_branch_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_orders_branch",
        ),
        # Orders are only ever "completed" or "voided"; guard against typos
        # writing an unknown status that would silently drop out of reports.
        CheckConstraint("status IN ('completed', 'voided')", name="ck_orders_status"),
        UniqueConstraint("tenant_id", "id", name="uq_orders_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "shift_id"],
            ["shifts.tenant_id", "shifts.branch_id", "shifts.id"],
            name="fk_orders_tenant_shift",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    client_uuid: Mapped[UUID | None] = mapped_column(nullable=True)
    # Shift the sale was rung in. Nullable: historical orders and offline syncs
    # stay unattributed and are excluded from a shift's expected cash.
    shift_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="completed")
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Client ring-time. For online sales this equals created_at (server now);
    # for offline sales it is the tenant-clamped time the sale was rung on the
    # device, so reports/receipts bucket by when the sale happened, not when it
    # synced. Nullable for the expand phase; the app layer always populates it.
    occurred_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=_now
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint(
            "unit_cost IS NULL OR unit_cost >= 0",
            name="ck_order_items_unit_cost_nonnegative",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "order_id"],
            ["orders.tenant_id", "orders.id"],
            name="fk_order_items_tenant_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_order_items_tenant_product",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    line_total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "order_id"],
            ["orders.tenant_id", "orders.id"],
            name="fk_payments_tenant_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    amount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount_tendered_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    change_due_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InventoryMovement(BranchScoped, Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_inventory_movements_branch",
        ),
        CheckConstraint(
            "reason_code IS NULL OR reason_code IN "
            "('merma', 'caducidad', 'robo', 'daño', 'autoconsumo', 'otro')",
            name="ck_inventory_movements_reason_code",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_inventory_movements_tenant_product",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_inventory_movements_tenant_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    stock_on_hand_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Refund(BranchScoped, Base):
    __tablename__ = "refunds"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_refunds_branch",
        ),
        UniqueConstraint("tenant_id", "id", name="uq_refunds_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_refunds_tenant_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    refunded_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # The tender the refund was paid back through (cash / bank_transfer /
    # manual_card). Nullable for rows created before this column existed; new
    # refunds always persist it so per-method drawer/report math ties out.
    refund_payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RefundItem(Base):
    __tablename__ = "refund_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "refund_id"],
            ["refunds.tenant_id", "refunds.id"],
            name="fk_refund_items_tenant_refund",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "order_item_id"],
            ["order_items.tenant_id", "order_items.id"],
            name="fk_refund_items_tenant_order_item",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    refund_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_item_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)


class Void(BranchScoped, Base):
    __tablename__ = "voids"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_voids_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_voids_tenant_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

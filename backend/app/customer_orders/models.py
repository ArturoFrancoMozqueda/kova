from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.orm_metadata import Base


def _now() -> datetime:
    return datetime.now(UTC)


class CustomerOrder(BranchScoped, Base):
    __tablename__ = "customer_orders"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "id", name="uq_customer_orders_tenant_branch_id"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_customer_orders_branch",
        ),
        CheckConstraint(
            "status IN ('new', 'confirmed', 'in_progress', 'ready', 'fulfilled', 'cancelled')",
            name="ck_customer_orders_status",
        ),
        CheckConstraint(
            "fulfillment_type IN ('pickup', 'delivery')",
            name="ck_customer_orders_fulfillment_type",
        ),
        CheckConstraint(
            "source_channel IN ('counter', 'phone_whatsapp', 'other')",
            name="ck_customer_orders_source_channel",
        ),
        UniqueConstraint("tenant_id", "folio", name="uq_customer_orders_tenant_folio"),
        UniqueConstraint("sale_order_id", name="uq_customer_orders_sale_order_id"),
        UniqueConstraint("tenant_id", "id", name="uq_customer_orders_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_customer_orders_tenant_sale",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"],
            name="fk_customer_orders_customer",
        ),
        Index("ix_customer_orders_customer", "tenant_id", "branch_id", "customer_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    folio: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="new")
    fulfillment_type: Mapped[str] = mapped_column(String(16), nullable=False, default="pickup")
    source_channel: Mapped[str] = mapped_column(String(24), nullable=False, default="counter")
    customer_id: Mapped[UUID | None] = mapped_column(nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    delivery_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    promised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subtotal_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    sale_order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    cancelled_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cancellation_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class CustomerOrderItem(Base):
    __tablename__ = "customer_order_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_customer_order_items_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.id"],
            name="fk_customer_order_items_tenant_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_customer_order_items_tenant_product",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)


class CustomerOrderItemModifier(Base):
    __tablename__ = "customer_order_item_modifiers"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "customer_order_item_id"],
            ["customer_order_items.tenant_id", "customer_order_items.id"],
            name="fk_customer_order_item_modifiers_tenant_item",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "modifier_group_id"],
            ["modifier_groups.tenant_id", "modifier_groups.id"],
            name="fk_customer_order_item_modifiers_tenant_group",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "modifier_option_id"],
            ["modifier_options.tenant_id", "modifier_options.id"],
            name="fk_customer_order_item_modifiers_tenant_option",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_order_item_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    modifier_group_id: Mapped[UUID] = mapped_column(nullable=False)
    modifier_group_name: Mapped[str] = mapped_column(String(120), nullable=False)
    modifier_option_id: Mapped[UUID] = mapped_column(nullable=False)
    modifier_option_name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_delta_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)


class InventoryReservation(BranchScoped, Base):
    __tablename__ = "inventory_reservations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "branch_id", "product_id", "id", name="uq_inventory_reservations_lot_owner"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_inventory_reservations_branch",
        ),
        CheckConstraint(
            "status IN ('active', 'consumed', 'released')",
            name="ck_inventory_reservations_status",
        ),
        UniqueConstraint(
            "customer_order_id", "product_id", name="uq_inventory_reservations_order_product"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
            name="fk_inventory_reservations_tenant_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_inventory_reservations_tenant_product",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    lot_tracked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class CustomerOrderSettings(Base):
    """Each business's deposit policy; no row means no minimum and returning deposits."""

    __tablename__ = "customer_order_settings"
    __table_args__ = (
        CheckConstraint(
            "deposit_minimum_percent >= 0 AND deposit_minimum_percent <= 100",
            name="ck_customer_order_settings_minimum",
        ),
        CheckConstraint(
            "cancelled_deposit_policy IN ('refund', 'retain')",
            name="ck_customer_order_settings_policy",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    deposit_minimum_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    cancelled_deposit_policy: Mapped[str] = mapped_column(
        String(16), nullable=False, default="refund", server_default="refund"
    )
    updated_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class CustomerOrderDeposit(BranchScoped, Base):
    """Append-only money history of an order before it is settled (anticipos)."""

    __tablename__ = "customer_order_deposits"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_customer_order_deposits_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
            name="fk_customer_order_deposits_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "shift_id"],
            ["shifts.tenant_id", "shifts.branch_id", "shifts.id"],
            name="fk_customer_order_deposits_shift",
        ),
        CheckConstraint(
            "kind IN ('deposit', 'refund', 'retained')", name="ck_customer_order_deposits_kind"
        ),
        CheckConstraint("amount > 0", name="ck_customer_order_deposits_amount"),
        CheckConstraint(
            "(kind = 'retained' AND method IS NULL AND shift_id IS NULL) OR "
            "(kind <> 'retained' AND method IS NOT NULL "
            "AND method IN ('cash', 'bank_transfer', 'manual_card'))",
            name="ck_customer_order_deposits_method",
        ),
        CheckConstraint(
            "method IS DISTINCT FROM 'cash' OR shift_id IS NOT NULL",
            name="ck_customer_order_deposits_cash_shift",
        ),
        CheckConstraint(
            "kind = 'deposit' OR coalesce(length(btrim(reason)), 0) > 0",
            name="ck_customer_order_deposits_reason",
        ),
        Index("ix_customer_order_deposits_order", "tenant_id", "customer_order_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_order_id: Mapped[UUID] = mapped_column(nullable=False)
    # deposit receives money, refund returns it, retained keeps it on cancellation.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shift_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

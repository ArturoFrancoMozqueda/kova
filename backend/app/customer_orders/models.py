from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
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
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    folio: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="new")
    fulfillment_type: Mapped[str] = mapped_column(String(16), nullable=False, default="pickup")
    source_channel: Mapped[str] = mapped_column(String(24), nullable=False, default="counter")
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

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


def now() -> datetime:
    return datetime.now(UTC)


class CustomerQuote(BranchScoped, Base):
    __tablename__ = "customer_quotes"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_customer_quote_owner"),
        UniqueConstraint("tenant_id", "folio", name="uq_customer_quote_folio"),
        UniqueConstraint("customer_order_id", name="uq_customer_quote_order"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(
            ["tenant_id", "updated_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("version >= 1 AND total_amount >= 0", name="ck_customer_quote_amount"),
        CheckConstraint(
            "status IN ('draft','sent','accepted','expired','cancelled')",
            name="ck_customer_quote_status",
        ),
        CheckConstraint(
            "(status = 'accepted') = (customer_order_id IS NOT NULL)",
            name="ck_customer_quote_accepted_order",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    folio: Mapped[str] = mapped_column(String(12), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    customer_phone: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    shared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    customer_order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    updated_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CustomerQuoteItem(BranchScoped, Base):
    __tablename__ = "customer_quote_items"
    __table_args__ = (
        UniqueConstraint("quote_id", "product_id", name="uq_customer_quote_item_product"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "quote_id"],
            ["customer_quotes.tenant_id", "customer_quotes.branch_id", "customer_quotes.id"],
        ),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
        CheckConstraint(
            "quantity > 0 AND quantity <= 100000 AND unit_price_amount >= 0 "
            "AND line_total_amount = unit_price_amount * quantity",
            name="ck_customer_quote_item_amount",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    quote_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

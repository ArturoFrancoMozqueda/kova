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


class Coupon(Base):
    """A promotion code: percent or amount off the whole sale, with dates and limits."""

    __tablename__ = "coupons"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_coupons_tenant_id"),
        UniqueConstraint("tenant_id", "code", name="uq_coupons_tenant_code"),
        CheckConstraint("code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'", name="ck_coupons_code"),
        CheckConstraint(
            "(kind = 'percent' AND value > 0 AND value <= 100) OR (kind = 'amount' AND value > 0)",
            name="ck_coupons_value",
        ),
        CheckConstraint("min_purchase IS NULL OR min_purchase >= 0", name="ck_coupons_min"),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at", name="ck_coupons_window"
        ),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_coupons_max_uses"),
        CheckConstraint(
            "max_uses_per_customer IS NULL OR max_uses_per_customer > 0",
            name="ck_coupons_max_per_customer",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(String(160), nullable=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    min_purchase: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_uses_per_customer: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class CouponRedemption(BranchScoped, Base):
    """One use of a coupon in a sale; voiding the sale releases it."""

    __tablename__ = "coupon_redemptions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
            name="fk_coupon_redemptions_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "coupon_id"], ["coupons.tenant_id", "coupons.id"],
            name="fk_coupon_redemptions_coupon",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_coupon_redemptions_sale",
        ),
        UniqueConstraint("sale_order_id", name="uq_coupon_redemptions_sale"),
        CheckConstraint("status IN ('applied', 'released')", name="ck_coupon_redemptions_status"),
        CheckConstraint("discount_amount > 0", name="ck_coupon_redemptions_amount"),
        Index("ix_coupon_redemptions_coupon", "tenant_id", "coupon_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    coupon_id: Mapped[UUID] = mapped_column(nullable=False)
    sale_order_id: Mapped[UUID] = mapped_column(nullable=False)
    customer_id: Mapped[UUID | None] = mapped_column(nullable=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="applied")
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

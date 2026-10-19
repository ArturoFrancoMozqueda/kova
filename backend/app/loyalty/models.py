"""Append-only internal points. No currency balance, payment or POS discount."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
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
from app.orm_metadata import Base


def now():
    return datetime.now(UTC)


class LoyaltyPolicyRevision(BranchScoped, Base):
    __tablename__ = "loyalty_policy_revisions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "version", name="uq_loyalty_policy_version"),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_loyalty_policy_owner"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint(
            "version >= 1 AND spend_amount >= .01 AND spend_amount <= 1000000 "
            "AND points_per_step BETWEEN 1 AND 10000",
            name="ck_loyalty_policy_bounds",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    spend_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    points_per_step: Mapped[int] = mapped_column(Integer, nullable=False)
    authorized_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    effective_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, nullable=False
    )


class LoyaltyEntry(BranchScoped, Base):
    __tablename__ = "loyalty_entries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "kind", "source_id", name="uq_loyalty_effect"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "policy_revision_id"],
            [
                "loyalty_policy_revisions.tenant_id",
                "loyalty_policy_revisions.branch_id",
                "loyalty_policy_revisions.id",
            ],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "recorded_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint(
            "kind IN ('accrual','refund','void','redemption')", name="ck_loyalty_entry_kind"
        ),
        CheckConstraint(
            "(kind = 'accrual' AND points >= 0) OR (kind != 'accrual' AND points <= 0)",
            name="ck_loyalty_entry_sign",
        ),
        CheckConstraint(
            "(kind = 'redemption' AND sale_order_id IS NULL AND policy_revision_id IS NULL "
            "AND benefit IS NOT NULL AND points < 0 AND recorded_by_user_id IS NOT NULL) OR "
            "(kind != 'redemption' AND sale_order_id IS NOT NULL "
            "AND policy_revision_id IS NOT NULL AND benefit IS NULL)",
            name="ck_loyalty_entry_source",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    sale_order_id: Mapped[UUID | None] = mapped_column()
    policy_revision_id: Mapped[UUID | None] = mapped_column()
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)
    points: Mapped[int] = mapped_column(BigInteger, nullable=False)
    benefit: Mapped[str | None] = mapped_column(String(300))
    recorded_by_user_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, nullable=False
    )

"""Private intake and internal retention work, never an outbound or financial ledger."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.crm.models import now
from app.orm_metadata import Base


class CatalogRequest(BranchScoped, Base):
    __tablename__ = "crm_catalog_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "catalog_id", "submission_id"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "catalog_id"], ["public_catalogs.tenant_id", "public_catalogs.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "opportunity_id"],
            ["crm_opportunities.tenant_id", "crm_opportunities.branch_id", "crm_opportunities.id"],
        ),
        CheckConstraint(
            "status IN ('new','converted','dismissed')", name="ck_catalog_request_status"
        ),
        CheckConstraint("version >= 1", name="ck_catalog_request_version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    catalog_id: Mapped[UUID] = mapped_column(nullable=False)
    submission_id: Mapped[UUID] = mapped_column(nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(String(1000), nullable=False)
    product_ids: Mapped[list] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="new", nullable=False)
    customer_id: Mapped[UUID | None] = mapped_column()
    opportunity_id: Mapped[UUID | None] = mapped_column()
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FollowupPolicy(BranchScoped, Base):
    __tablename__ = "crm_followup_policies"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint(
            "review_delay_days BETWEEN 1 AND 30 AND rebuy_delay_days BETWEEN 2 AND 365",
            name="ck_followup_policy_delays",
        ),
        CheckConstraint("version >= 1", name="ck_followup_policy_version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    review_delay_days: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    rebuy_delay_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    authorized_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    enabled_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FollowupTask(BranchScoped, Base):
    __tablename__ = "crm_followup_tasks"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "sale_order_id", "kind"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("kind IN ('review','rebuy','incident')", name="ck_followup_task_kind"),
        CheckConstraint(
            "status IN ('pending','completed','dismissed')", name="ck_followup_task_status"
        ),
        CheckConstraint("version >= 1", name="ck_followup_task_version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    customer_id: Mapped[UUID] = mapped_column(nullable=False)
    sale_order_id: Mapped[UUID | None] = mapped_column()
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(String(1000))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assigned_user_id: Mapped[UUID | None] = mapped_column()
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

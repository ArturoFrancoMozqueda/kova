from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
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
from app.orm_metadata import Base


def now() -> datetime:
    return datetime.now(UTC)


class AutomationRule(BranchScoped, Base):
    __tablename__ = "automation_rules"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "template_key", name="uq_automation_rule_key"),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_automation_rule_owner"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        CheckConstraint("version >= 1", name="ck_automation_rule_version"),
        CheckConstraint(
            "template_key IN ('order_ready', 'order_fulfilled', 'restock_review', "
            "'service_case_overdue')",
            name="ck_automation_rule_template",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    template_key: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    authorized_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    enabled_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class BusinessEvent(BranchScoped, Base):
    __tablename__ = "business_events"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "event_type",
            "entity_id",
            "entity_version",
            name="uq_business_event_identity",
        ),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_business_event_owner"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        CheckConstraint("entity_version >= 1", name="ck_business_event_version"),
        CheckConstraint(
            "event_type IN ('customer_order.ready', 'customer_order.fulfilled', "
            "'customer_order.cancelled', 'inventory.restock_review', 'service_case.review_due')",
            name="ck_business_event_type",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    entity_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class AutomationRun(BranchScoped, Base):
    __tablename__ = "automation_runs"
    __table_args__ = (
        UniqueConstraint("event_id", "rule_id", name="uq_automation_run_effect"),
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_automation_run_owner"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "event_id"],
            ["business_events.tenant_id", "business_events.branch_id", "business_events.id"],
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "rule_id"],
            ["automation_rules.tenant_id", "automation_rules.branch_id", "automation_rules.id"],
        ),
        CheckConstraint("version >= 1 AND rule_version >= 1", name="ck_automation_run_version"),
        CheckConstraint(
            "status IN ('pending', 'completed', 'dismissed', 'suppressed')",
            name="ck_automation_run_status",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    event_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    rule_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    template_key: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    entity_type: Mapped[str] = mapped_column(String(24), nullable=False)
    entity_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

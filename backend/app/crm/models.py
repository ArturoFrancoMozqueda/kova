from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


def now():
    return datetime.now(UTC)


class Opportunity(BranchScoped, Base):
    __tablename__ = "crm_opportunities"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_crm_opportunities_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_crm_opportunities_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "customer_id"],
            ["customers.tenant_id", "customers.id"],
            name="fk_crm_opportunities_customer",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
            name="fk_crm_opportunities_assignee",
        ),
        CheckConstraint(
            "stage IN ('new','contacted','proposal','won','lost')", name="ck_crm_stage"
        ),
        CheckConstraint("estimated_amount >= 0", name="ck_crm_estimated_amount"),
        CheckConstraint("version >= 1", name="ck_crm_opportunity_version"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    stage: Mapped[str] = mapped_column(String(20), default="new", nullable=False)
    estimated_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    assigned_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    next_action: Mapped[str | None] = mapped_column(String(300), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    updated_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ContactConsent(BranchScoped, Base):
    __tablename__ = "customer_contact_consents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_contact_consents_tenant_id_id"),
        UniqueConstraint(
            "tenant_id",
            "branch_id",
            "customer_id",
            "channel",
            "purpose",
            name="uq_customer_contact_consent_scope",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_contact_consents_branch",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "customer_id"],
            ["customers.tenant_id", "customers.id"],
            name="fk_contact_consents_customer",
        ),
        CheckConstraint("channel IN ('whatsapp','email')", name="ck_contact_consent_channel"),
        CheckConstraint(
            "purpose IN ('transactional','marketing')", name="ck_contact_consent_purpose"
        ),
        CheckConstraint("source = 'owner_recorded'", name="ck_contact_consent_source"),
        CheckConstraint("version >= 1", name="ck_contact_consent_version"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source: Mapped[str] = mapped_column(String(24), default="owner_recorded", nullable=False)
    # Consent follows the selected address, never a replacement phone/email silently.
    contact_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    recorded_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

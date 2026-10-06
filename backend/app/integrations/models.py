from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base


class FiscalIssuerProfile(Base):
    __tablename__ = "fiscal_issuer_profiles"
    __table_args__ = (ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),)
    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    fiscal_data: Mapped[dict] = mapped_column(JSON, nullable=False)


class InvoiceRequest(BranchScoped, Base):
    __tablename__ = "invoice_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "order_id", name="uq_invoice_requests_order"),
        UniqueConstraint("tenant_id", "id", name="uq_invoice_requests_tenant_id_id"),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_invoice_requests_order",
        ),
        CheckConstraint("status = 'pending_provider'", name="ck_invoice_requests_pending"),
        CheckConstraint("total_amount > 0", name="ck_invoice_requests_total"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_provider")
    issuer_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    pricing_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    recipient_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

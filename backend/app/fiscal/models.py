from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class OrderFiscalSnapshot(Base):
    __tablename__ = "order_fiscal_snapshots"
    __table_args__ = (
        CheckConstraint("gross_amount >= 0", name="ck_order_fiscal_snapshots_gross"),
        CheckConstraint("discount_total_amount >= 0", name="ck_order_fiscal_snapshots_discount"),
        CheckConstraint("tax_total_amount >= 0", name="ck_order_fiscal_snapshots_tax"),
        CheckConstraint("total_amount >= 0", name="ck_order_fiscal_snapshots_total"),
        CheckConstraint(
            "gross_amount - discount_total_amount + tax_total_amount = total_amount",
            name="ck_order_fiscal_snapshots_equation",
        ),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_order_fiscal_snapshots_currency"),
        CheckConstraint(
            "individual_fiscal_status IN ('none', 'confirmed')",
            name="ck_order_fiscal_snapshots_individual_status",
        ),
        UniqueConstraint("tenant_id", "order_id", name="uq_order_fiscal_snapshots_tenant_order"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    pricing_engine_version: Mapped[str] = mapped_column(String(40), nullable=False)
    tax_catalog_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    tax_calculation_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="not_calculated"
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN")
    # Reserved for a future PAC integration. No route in this slice can set it.
    individual_fiscal_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="none"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class OrderItemFiscalSnapshot(Base):
    __tablename__ = "order_item_fiscal_snapshots"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_item_fiscal_snapshots_quantity"),
        CheckConstraint(
            "gross_line_amount >= 0 AND line_discount_amount >= 0 "
            "AND order_discount_allocated_amount >= 0 AND net_before_tax_amount >= 0 "
            "AND tax_total_amount >= 0 AND line_total_amount >= 0",
            name="ck_order_item_fiscal_snapshots_amounts",
        ),
        CheckConstraint(
            "gross_line_amount - line_discount_amount - order_discount_allocated_amount "
            "= net_before_tax_amount",
            name="ck_order_item_fiscal_snapshots_net_equation",
        ),
        CheckConstraint(
            "net_before_tax_amount + tax_total_amount = line_total_amount",
            name="ck_order_item_fiscal_snapshots_total_equation",
        ),
        UniqueConstraint(
            "tenant_id", "order_item_id", name="uq_order_item_fiscal_snapshots_tenant_item"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_item_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    gross_line_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    order_discount_allocated_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    net_before_tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_object_code_snapshot: Mapped[str | None] = mapped_column(String(8), nullable=True)
    product_service_code_snapshot: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_code_snapshot: Mapped[str | None] = mapped_column(String(16), nullable=True)
    tax_calculation_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="not_calculated"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class OrderItemTaxSnapshot(Base):
    __tablename__ = "order_item_tax_snapshots"
    __table_args__ = (
        CheckConstraint(
            "direction IN ('transfer', 'withholding')", name="ck_tax_snapshots_direction"
        ),
        CheckConstraint(
            "factor_type IN ('rate', 'quota', 'exempt')", name="ck_tax_snapshots_factor"
        ),
        CheckConstraint("base_amount >= 0", name="ck_tax_snapshots_base"),
        CheckConstraint(
            "rate_or_quota IS NULL OR rate_or_quota >= 0", name="ck_tax_snapshots_rate"
        ),
        CheckConstraint("tax_amount IS NULL OR tax_amount >= 0", name="ck_tax_snapshots_amount"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_item_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    tax_code: Mapped[str] = mapped_column(String(16), nullable=False)
    factor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    base_amount: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    rate_or_quota: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    catalog_version: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class FiscalGlobalDraftSettings(Base):
    __tablename__ = "fiscal_global_draft_settings"
    __table_args__ = (
        CheckConstraint(
            "frequency IN ('daily', 'weekly', 'monthly')", name="ck_fiscal_draft_frequency"
        ),
        CheckConstraint(
            "weekly_close_day BETWEEN 1 AND 7", name="ck_fiscal_draft_weekly_close_day"
        ),
        CheckConstraint(
            "monthly_close_day BETWEEN 1 AND 31", name="ck_fiscal_draft_monthly_close_day"
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    frequency: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    weekly_close_day: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    monthly_close_day: Mapped[int] = mapped_column(Integer, nullable=False, default=31)
    auto_close_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    auto_processed_through: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class FiscalGlobalDraftBatch(Base):
    __tablename__ = "fiscal_global_draft_batches"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'closed')", name="ck_fiscal_global_draft_status"),
        CheckConstraint(
            "document_kind = 'operational_draft'", name="ck_fiscal_global_document_kind"
        ),
        CheckConstraint("fiscal_status = 'not_issued'", name="ck_fiscal_global_fiscal_status"),
        CheckConstraint("period_start <= period_end", name="ck_fiscal_global_period"),
        CheckConstraint("order_count >= 0", name="ck_fiscal_global_order_count"),
        CheckConstraint(
            "refund_total_amount >= 0 AND net_total_amount >= 0 "
            "AND total_amount - refund_total_amount = net_total_amount",
            name="ck_fiscal_global_refund_net",
        ),
        UniqueConstraint(
            "tenant_id", "period_start", "period_end", name="uq_fiscal_global_tenant_period"
        ),
        UniqueConstraint("tenant_id", "id", name="uq_fiscal_global_batches_tenant_id_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    frequency: Mapped[str] = mapped_column(String(16), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="America/Mexico_City")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="closed")
    document_kind: Mapped[str] = mapped_column(
        String(32), nullable=False, default="operational_draft"
    )
    fiscal_status: Mapped[str] = mapped_column(String(16), nullable=False, default="not_issued")
    business_name_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)
    package_schema_version: Mapped[str] = mapped_column(
        String(40), nullable=False, default="legacy-v1"
    )
    tax_calculation_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="not_calculated"
    )
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    refund_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    net_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    adjustment_total_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    adjusted_net_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00")
    )
    adjustment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data_quality_warnings: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    order_count: Mapped[int] = mapped_column(Integer, nullable=False)
    excluded_individually_confirmed_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    closed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class FiscalGlobalDraftOrder(Base):
    __tablename__ = "fiscal_global_draft_orders"
    __table_args__ = (
        CheckConstraint(
            "refund_total_amount >= 0 AND net_total_amount >= 0",
            name="ck_fiscal_global_draft_orders_refund_net",
        ),
        UniqueConstraint(
            "tenant_id", "order_id", name="uq_fiscal_global_draft_orders_tenant_order"
        ),
        Index(
            "ix_fiscal_global_draft_orders_tenant_batch",
            "tenant_id",
            "batch_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    batch_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    refund_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    net_total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class FiscalIndividualInvoiceEvent(Base):
    __tablename__ = "fiscal_individual_invoice_events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('confirmed', 'reopened')",
            name="ck_fiscal_individual_invoice_event_status",
        ),
        Index(
            "ix_fiscal_individual_events_tenant_order_created",
            "tenant_id",
            "order_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    external_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class FiscalGlobalDraftAdjustment(Base):
    __tablename__ = "fiscal_global_draft_adjustments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_fiscal_adjustment_amount"),
        CheckConstraint(
            "adjustment_type IN ('late_refund', 'late_inclusion', 'late_exclusion')",
            name="ck_fiscal_adjustment_type",
        ),
        UniqueConstraint(
            "tenant_id", "source_refund_id", name="uq_fiscal_adjustment_tenant_refund"
        ),
        UniqueConstraint(
            "tenant_id", "source_event_id", name="uq_fiscal_adjustment_tenant_event"
        ),
        Index("ix_fiscal_adjustments_tenant_batch", "tenant_id", "batch_id"),
        Index(
            "ix_fiscal_adjustments_tenant_original_batch",
            "tenant_id",
            "original_batch_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    batch_id: Mapped[UUID] = mapped_column(nullable=False)
    original_batch_id: Mapped[UUID] = mapped_column(nullable=False)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    source_refund_id: Mapped[UUID | None] = mapped_column(nullable=True)
    source_event_id: Mapped[UUID | None] = mapped_column(nullable=True)
    adjustment_type: Mapped[str] = mapped_column(String(24), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )

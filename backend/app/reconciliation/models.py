from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
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


class ImportBatch(BranchScoped, Base):
    __tablename__ = "reconciliation_import_batches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_reconciliation_batches_scope_id"),
        UniqueConstraint(
            "tenant_id", "branch_id", "content_sha256", name="uq_reconciliation_batch_content"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_reconciliation_batch_branch",
        ),
        CheckConstraint("row_count > 0 AND row_count <= 500", name="ck_reconciliation_batch_count"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    parser_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_type: Mapped[str] = mapped_column(String(24), nullable=False, default="manual_csv")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SettlementEntry(BranchScoped, Base):
    __tablename__ = "settlement_entries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", "id", name="uq_settlement_entries_scope_id"),
        UniqueConstraint(
            "tenant_id", "branch_id", "row_fingerprint", name="uq_settlement_entries_row"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "batch_id"],
            [
                "reconciliation_import_batches.tenant_id",
                "reconciliation_import_batches.branch_id",
                "reconciliation_import_batches.id",
            ],
            name="fk_settlement_entry_batch",
        ),
        CheckConstraint(
            "gross_amount > 0 AND fee_amount >= 0 AND net_amount > 0 "
            "AND gross_amount - fee_amount = net_amount",
            name="ck_settlement_entry_amounts",
        ),
        CheckConstraint("currency = 'MXN'", name="ck_settlement_entry_currency"),
        CheckConstraint(
            "payment_method IN ('bank_transfer','manual_card')", name="ck_settlement_entry_method"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    batch_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    settled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    fee_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    net_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(24), nullable=False)
    external_reference_masked: Mapped[str] = mapped_column(String(64), nullable=False)
    row_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)


class ReconciliationMatch(BranchScoped, Base):
    __tablename__ = "reconciliation_matches"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "settlement_entry_id", "payment_id", name="uq_reconciliation_match_payment"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "settlement_entry_id"],
            [
                "settlement_entries.tenant_id",
                "settlement_entries.branch_id",
                "settlement_entries.id",
            ],
            name="fk_reconciliation_match_entry",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_reconciliation_match_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "order_id", "payment_id"],
            ["payments.tenant_id", "payments.order_id", "payments.id"],
            name="fk_reconciliation_match_payment",
        ),
        CheckConstraint("matched_amount > 0", name="ck_reconciliation_match_amount"),
        CheckConstraint(
            "status IN ('suggested','confirmed','rejected','reversed')",
            name="ck_reconciliation_match_status",
        ),
        CheckConstraint("version > 0", name="ck_reconciliation_match_version"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    settlement_entry_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    payment_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    matched_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="suggested")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reasons: Mapped[list] = mapped_column(JSON, nullable=False)
    confirmed_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

"""add shifts and cash_movements tables

Revision ID: 0010_shifts
Revises: 0010_refund_void_constraints
Create Date: 2026-05-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_shifts"
down_revision: str | None = "0010_refund_void_constraints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shifts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("opened_by_user_id", sa.UUID(), nullable=True),
        sa.Column("closed_by_user_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("opening_cash_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("actual_cash_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_cash_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("reconciliation_status", sa.String(20), nullable=True),
        sa.Column("variance_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shifts_tenant_id", "shifts", ["tenant_id"])

    op.create_table(
        "cash_movements",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("shift_id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"]),
    )
    op.create_index("ix_cash_movements_shift_id", "cash_movements", ["shift_id"])
    op.create_index("ix_cash_movements_tenant_id", "cash_movements", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("cash_movements")
    op.drop_table("shifts")

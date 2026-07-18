"""add tenant-scoped operating expenses

Revision ID: 0049_operating_expenses
Revises: 0048_inventory_reason_code
Create Date: 2026-07-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0049_operating_expenses"
down_revision: str | None = "0048_inventory_reason_code"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_expenses_amount_positive"),
        sa.CheckConstraint(
            "category IN ('renta', 'nomina', 'servicios', 'transporte', "
            "'mantenimiento', 'marketing', 'comisiones', 'impuestos', 'otro')",
            name="ck_expenses_category",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expenses_tenant_id", "expenses", ["tenant_id"])
    op.create_index(
        "ix_expenses_tenant_date", "expenses", ["tenant_id", "expense_date"]
    )
    op.execute("ALTER TABLE expenses ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE expenses FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON expenses "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON expenses")
    op.drop_index("ix_expenses_tenant_date", table_name="expenses")
    op.drop_index("ix_expenses_tenant_id", table_name="expenses")
    op.drop_table("expenses")

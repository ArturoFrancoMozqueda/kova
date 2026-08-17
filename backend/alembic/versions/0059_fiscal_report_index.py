"""index accountant report batch lookup

Revision ID: 0059_fiscal_report_idx
Revises: 0058_fiscal_snapshots
Create Date: 2026-08-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0059_fiscal_report_idx"
down_revision: str | None = "0058_fiscal_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_fiscal_global_draft_orders_tenant_batch",
        "fiscal_global_draft_orders",
        ["tenant_id", "batch_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_fiscal_global_draft_orders_tenant_batch",
        table_name="fiscal_global_draft_orders",
    )

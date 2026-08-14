"""add configurable thermal receipt paper width

Revision ID: 0057_receipt_paper_width
Revises: 20e47faf64eb
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0057_receipt_paper_width"
down_revision: str | None = "20e47faf64eb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenant_receipt_settings",
        sa.Column("paper_width_mm", sa.Integer(), nullable=False, server_default="80"),
    )
    op.create_check_constraint(
        "ck_receipt_settings_paper_width",
        "tenant_receipt_settings",
        "paper_width_mm IN (58, 80)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_receipt_settings_paper_width",
        "tenant_receipt_settings",
        type_="check",
    )
    op.drop_column("tenant_receipt_settings", "paper_width_mm")

"""add stock_on_hand_after to inventory_movements for movement history

Revision ID: 0017_inventory_movement_history
Revises: 0016_pmg_rls_policy
Create Date: 2026-05-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_inventory_movement_history"
down_revision: str | None = "0016_pmg_rls_policy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_movements",
        sa.Column("stock_on_hand_after", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("inventory_movements", "stock_on_hand_after")

"""add inventory basics metadata

Revision ID: 0011_inventory_basics
Revises: 0010_shifts
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_inventory_basics"
down_revision: str | None = "0010_shifts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("low_stock_threshold", sa.Integer(), nullable=True))
    op.add_column("inventory_movements", sa.Column("reason", sa.String(255), nullable=True))
    op.add_column(
        "inventory_movements",
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
    )

    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale','adjustment','stock_take')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale')",
    )
    op.drop_column("inventory_movements", "created_by_user_id")
    op.drop_column("inventory_movements", "reason")
    op.drop_column("products", "low_stock_threshold")

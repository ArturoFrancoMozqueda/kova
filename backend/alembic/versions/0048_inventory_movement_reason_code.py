"""add typed inventory movement reason codes

Revision ID: 0048_inventory_reason_code
Revises: 0047_product_cost_snapshots
Create Date: 2026-07-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0048_inventory_reason_code"
down_revision: str | None = "0047_product_cost_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_movements",
        sa.Column("reason_code", sa.String(length=30), nullable=True),
    )
    op.create_check_constraint(
        "ck_inventory_movements_reason_code",
        "inventory_movements",
        "reason_code IS NULL OR reason_code IN "
        "('merma', 'caducidad', 'robo', 'daño', 'autoconsumo', 'otro')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_inventory_movements_reason_code",
        "inventory_movements",
        type_="check",
    )
    op.drop_column("inventory_movements", "reason_code")

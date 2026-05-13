"""change modifier price_delta columns from Numeric(12,4) to Numeric(12,2)

Revision ID: 0015_modifier_price_precision
Revises: 0014_modifiers
Create Date: 2026-05-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_modifier_price_precision"
down_revision: str | None = "0014_modifiers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "modifier_options",
        "price_delta",
        type_=sa.Numeric(12, 2),
        existing_type=sa.Numeric(12, 4),
        postgresql_using="price_delta::numeric(12,2)",
    )
    op.alter_column(
        "order_item_modifiers",
        "price_delta_amount",
        type_=sa.Numeric(12, 2),
        existing_type=sa.Numeric(12, 4),
        postgresql_using="price_delta_amount::numeric(12,2)",
    )


def downgrade() -> None:
    op.alter_column(
        "modifier_options",
        "price_delta",
        type_=sa.Numeric(12, 4),
        existing_type=sa.Numeric(12, 2),
        postgresql_using="price_delta::numeric(12,4)",
    )
    op.alter_column(
        "order_item_modifiers",
        "price_delta_amount",
        type_=sa.Numeric(12, 4),
        existing_type=sa.Numeric(12, 2),
        postgresql_using="price_delta_amount::numeric(12,4)",
    )

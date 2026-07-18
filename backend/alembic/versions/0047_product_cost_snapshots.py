"""add product cost and sale-time cost snapshots

Revision ID: 0047_product_cost_snapshots
Revises: 0046_tenant_feature_overrides
Create Date: 2026-07-18

Both columns are additive and nullable. Existing rows intentionally remain NULL because
Kova cannot infer trustworthy historical costs.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0047_product_cost_snapshots"
down_revision: str | None = "0046_tenant_feature_overrides"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("cost_price", sa.Numeric(12, 2), nullable=True),
    )
    op.create_check_constraint(
        "ck_products_cost_price_nonnegative",
        "products",
        "cost_price IS NULL OR cost_price >= 0",
    )
    op.add_column(
        "order_items",
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True),
    )
    op.create_check_constraint(
        "ck_order_items_unit_cost_nonnegative",
        "order_items",
        "unit_cost IS NULL OR unit_cost >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_order_items_unit_cost_nonnegative",
        "order_items",
        type_="check",
    )
    op.drop_column("order_items", "unit_cost")
    op.drop_constraint(
        "ck_products_cost_price_nonnegative",
        "products",
        type_="check",
    )
    op.drop_column("products", "cost_price")


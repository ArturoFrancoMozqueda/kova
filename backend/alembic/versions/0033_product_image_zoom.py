"""add product image zoom

Revision ID: 0033_product_image_zoom
Revises: 0032_orders_status_check
Create Date: 2026-06-13 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0033_product_image_zoom"
down_revision: str | None = "0032_orders_status_check"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "image_zoom",
            sa.Float(),
            nullable=False,
            server_default=sa.text("1.0"),
        ),
    )
    op.create_check_constraint(
        "ck_products_image_zoom_range",
        "products",
        "image_zoom >= 0.5 AND image_zoom <= 3.0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_image_zoom_range", "products", type_="check")
    op.drop_column("products", "image_zoom")

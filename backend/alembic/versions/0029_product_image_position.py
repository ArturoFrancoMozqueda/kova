"""add product image position

Revision ID: 0029_product_image_position
Revises: 0028_user_terms_consent
Create Date: 2026-06-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0029_product_image_position"
down_revision: str | None = "0028_user_terms_consent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "image_position_x",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("50"),
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "image_position_y",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("50"),
        ),
    )
    op.create_check_constraint(
        "ck_products_image_position_x_range",
        "products",
        "image_position_x >= 0 AND image_position_x <= 100",
    )
    op.create_check_constraint(
        "ck_products_image_position_y_range",
        "products",
        "image_position_y >= 0 AND image_position_y <= 100",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_image_position_y_range", "products", type_="check")
    op.drop_constraint("ck_products_image_position_x_range", "products", type_="check")
    op.drop_column("products", "image_position_y")
    op.drop_column("products", "image_position_x")

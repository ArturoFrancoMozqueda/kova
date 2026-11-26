"""Ingredients, stock units and purchase units.

Stock stays in whole numbers of the product's base unit (piece, gram or
millilitre), so every existing Integer inventory column keeps its meaning.
A purchase unit ("Litro" = 1000 ml) converts received quantities; purchase
lines snapshot the factor so changing the catalog never rewrites an order
that is already in transit. Defaults reproduce the previous behaviour for
existing rows and for writes from an older app version after a rollback.
"""

import sqlalchemy as sa

from alembic import op

revision = "0110_ingredients_units"
down_revision = "0109_refund_item_restock"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "products",
        sa.Column("is_sellable", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "products",
        sa.Column("stock_unit", sa.String(8), nullable=False, server_default="pza"),
    )
    op.add_column("products", sa.Column("purchase_unit_label", sa.String(40), nullable=True))
    op.add_column("products", sa.Column("purchase_unit_quantity", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_products_stock_unit", "products", "stock_unit IN ('pza', 'g', 'ml')"
    )
    op.create_check_constraint(
        "ck_products_purchase_unit",
        "products",
        "(purchase_unit_label IS NULL AND purchase_unit_quantity IS NULL) OR "
        "(purchase_unit_label IS NOT NULL AND purchase_unit_quantity IS NOT NULL "
            "AND purchase_unit_quantity > 0)",
    )
    op.add_column(
        "purchase_order_items",
        sa.Column("units_per_purchase", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "purchase_order_items", sa.Column("purchase_unit_label", sa.String(40), nullable=True)
    )
    op.create_check_constraint(
        "ck_purchase_items_units_per_purchase", "purchase_order_items", "units_per_purchase > 0"
    )


def downgrade():
    op.drop_constraint(
        "ck_purchase_items_units_per_purchase", "purchase_order_items", type_="check"
    )
    op.drop_column("purchase_order_items", "purchase_unit_label")
    op.drop_column("purchase_order_items", "units_per_purchase")
    op.drop_constraint("ck_products_purchase_unit", "products", type_="check")
    op.drop_constraint("ck_products_stock_unit", "products", type_="check")
    op.drop_column("products", "purchase_unit_quantity")
    op.drop_column("products", "purchase_unit_label")
    op.drop_column("products", "stock_unit")
    op.drop_column("products", "is_sellable")

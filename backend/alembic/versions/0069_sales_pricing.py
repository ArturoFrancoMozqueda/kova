"""Persist sale discounts, added tax and tenant register defaults.

Revision ID: 0069_sales_pricing
Revises: 0068_branches
"""

import sqlalchemy as sa

from alembic import op

revision = "0069_sales_pricing"
down_revision = "0068_branches"
branch_labels = None
depends_on = None


def upgrade():
    for name, precision in (("discount_amount", 12), ("tax_rate", 5), ("tax_amount", 12)):
        op.add_column(
            "orders", sa.Column(name, sa.Numeric(precision, 2), nullable=False, server_default="0")
        )
    for name in ("discount_amount", "tax_amount"):
        op.add_column(
            "order_items", sa.Column(name, sa.Numeric(12, 2), nullable=False, server_default="0")
        )
    op.create_check_constraint(
        "ck_orders_discount",
        "orders",
        "discount_amount >= 0 AND discount_amount <= subtotal_amount",
    )
    op.create_check_constraint(
        "ck_orders_tax", "orders", "tax_rate >= 0 AND tax_rate <= 100 AND tax_amount >= 0"
    )
    op.add_column(
        "tenant_receipt_settings",
        sa.Column("default_tax_rate", sa.Numeric(5, 2), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_receipt_settings_tax_rate",
        "tenant_receipt_settings",
        "default_tax_rate >= 0 AND default_tax_rate <= 100",
    )


def downgrade():
    # Historical financial evidence must not be silently erased by rollback.
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM orders WHERE discount_amount <> 0 OR tax_amount <> 0 OR tax_rate <> 0)"
            )
        )
        .scalar()
    ):
        raise RuntimeError(
            "Cannot remove pricing snapshots after adjusted sales have been recorded"
        )
    for name in ("discount_amount", "tax_amount"):
        op.drop_column("order_items", name)
    op.drop_constraint("ck_receipt_settings_tax_rate", "tenant_receipt_settings", type_="check")
    op.drop_column("tenant_receipt_settings", "default_tax_rate")
    op.drop_constraint("ck_orders_tax", "orders", type_="check")
    op.drop_constraint("ck_orders_discount", "orders", type_="check")
    for name in ("tax_amount", "tax_rate", "discount_amount"):
        op.drop_column("orders", name)

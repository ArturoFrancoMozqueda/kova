"""Record how many refunded units went back to stock.

NULL marks refunds written before this revision (and by an older app version
after a rollback); those kept the previous rule of restoring what the sale had
consumed. New refunds store the exact restored quantity, so a refund can return
money without inflating stock and reports can value the unrestored units.
"""

import sqlalchemy as sa

from alembic import op

revision = "0109_refund_item_restock"
down_revision = "0108_refund_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "refund_items", sa.Column("restocked_quantity", sa.Integer(), nullable=True)
    )
    op.create_check_constraint(
        "ck_refund_items_restocked_quantity",
        "refund_items",
        "restocked_quantity IS NULL OR "
        "(restocked_quantity >= 0 AND restocked_quantity <= quantity)",
    )


def downgrade():
    op.drop_constraint("ck_refund_items_restocked_quantity", "refund_items", type_="check")
    op.drop_column("refund_items", "restocked_quantity")

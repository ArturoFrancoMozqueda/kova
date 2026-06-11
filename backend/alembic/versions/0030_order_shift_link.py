"""link orders to the shift they were sold in

Adds a nullable orders.shift_id so cash sales can be attributed to the open
shift and included in the expected-cash reconciliation at close. Nullable +
no backfill keeps it backward compatible: pre-existing orders and offline
syncs simply stay unattributed (shift_id NULL) and are excluded from a
shift's expected cash, exactly as before this change.

Revision ID: 0030_order_shift_link
Revises: 0029_product_image_position
Create Date: 2026-06-10 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0030_order_shift_link"
down_revision: str | None = "0029_product_image_position"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("shift_id", sa.UUID(), nullable=True))
    op.create_index(
        "ix_orders_tenant_shift",
        "orders",
        ["tenant_id", "shift_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_orders_tenant_shift", table_name="orders")
    op.drop_column("orders", "shift_id")

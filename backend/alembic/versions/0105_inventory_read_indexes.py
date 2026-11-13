"""Covering indexes for stock-on-hand and sales-velocity reads.

Stock on hand is SUM(quantity_delta) over the movement history. The 0068
index (tenant_id, branch_id, product_id) finds the rows but must visit the heap
for quantity_delta; the replacement carries it so the aggregate is index-only.
Velocity/reorder reads filter movement_type='sale' and a recent created_at
window, which had no index beyond tenant_id.

Indexes only: the previous app version issues the same queries, so a release
rollback keeps working on this schema. tenant_id stays the leading column.
"""

from alembic import op

revision = "0105_inventory_read_indexes"
down_revision = "0104_table_reservation_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_inventory_movements_stock",
        "inventory_movements",
        ["tenant_id", "branch_id", "product_id"],
        postgresql_include=["quantity_delta"],
    )
    # Superseded: same key columns, now covering.
    op.drop_index("ix_inventory_branch_product", table_name="inventory_movements")
    op.create_index(
        "ix_inventory_movements_type_time",
        "inventory_movements",
        ["tenant_id", "branch_id", "movement_type", "created_at"],
        postgresql_include=["product_id", "quantity_delta"],
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_movements_type_time", table_name="inventory_movements")
    op.create_index(
        "ix_inventory_branch_product",
        "inventory_movements",
        ["tenant_id", "branch_id", "product_id"],
    )
    op.drop_index("ix_inventory_movements_stock", table_name="inventory_movements")

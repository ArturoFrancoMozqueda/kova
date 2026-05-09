"""allow voided orders and protect refund void tenant rows

Revision ID: 0010_refund_void_constraints
Revises: 0009_refunds_voids
Create Date: 2026-05-08
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010_refund_void_constraints"
down_revision: str | None = "0009_refunds_voids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint(
        "ck_orders_status",
        "orders",
        "status IN ('completed','voided')",
    )

    for table_name in ("refunds", "voids"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table_name} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )

    op.create_check_constraint(
        "ck_refund_items_quantity_positive",
        "refund_items",
        "quantity > 0",
    )
    op.create_check_constraint(
        "ck_refund_items_unit_price_non_negative",
        "refund_items",
        "unit_price_amount >= 0",
    )
    op.create_check_constraint(
        "ck_refund_items_line_total_non_negative",
        "refund_items",
        "line_total_amount >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_refund_items_line_total_non_negative", "refund_items", type_="check")
    op.drop_constraint("ck_refund_items_unit_price_non_negative", "refund_items", type_="check")
    op.drop_constraint("ck_refund_items_quantity_positive", "refund_items", type_="check")

    for table_name in ("voids", "refunds"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")

    op.drop_constraint("ck_orders_status", "orders", type_="check")
    op.create_check_constraint("ck_orders_status", "orders", "status IN ('completed')")

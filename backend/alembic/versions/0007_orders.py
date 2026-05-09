"""orders payments and inventory movements

Revision ID: 0007_orders
Revises: 0006_catalog
Create Date: 2026-05-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_orders"
down_revision: str | None = "0006_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("subtotal_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('completed')", name="ck_orders_status"),
        sa.CheckConstraint("subtotal_amount >= 0", name="ck_orders_subtotal_non_negative"),
        sa.CheckConstraint("total_amount >= 0", name="ck_orders_total_non_negative"),
    )
    op.create_index("ix_orders_tenant_id", "orders", ["tenant_id"])
    op.create_index("ix_orders_created_by_user_id", "orders", ["created_by_user_id"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_name", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total_amount", sa.Numeric(12, 2), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
        sa.CheckConstraint("unit_price_amount >= 0", name="ck_order_items_unit_price_non_negative"),
        sa.CheckConstraint("line_total_amount >= 0", name="ck_order_items_line_total_non_negative"),
    )
    op.create_index("ix_order_items_tenant_id", "order_items", ["tenant_id"])
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_product_id", "order_items", ["product_id"])

    op.create_table(
        "payments",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("method", sa.String(30), nullable=False),
        sa.Column("amount_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("amount_tendered_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("change_due_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("method IN ('cash','bank_transfer','manual_card')", name="ck_payments_method"),
        sa.CheckConstraint("amount_amount >= 0", name="ck_payments_amount_non_negative"),
        sa.CheckConstraint("change_due_amount >= 0", name="ck_payments_change_non_negative"),
    )
    op.create_index("ix_payments_tenant_id", "payments", ["tenant_id"])
    op.create_index("ix_payments_order_id", "payments", ["order_id"])

    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=True),
        sa.Column("movement_type", sa.String(30), nullable=False),
        sa.Column("quantity_delta", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("movement_type IN ('sale')", name="ck_inventory_movements_type"),
        sa.CheckConstraint("quantity_delta <> 0", name="ck_inventory_movements_non_zero"),
    )
    op.create_index("ix_inventory_movements_tenant_id", "inventory_movements", ["tenant_id"])
    op.create_index("ix_inventory_movements_product_id", "inventory_movements", ["product_id"])
    op.create_index("ix_inventory_movements_order_id", "inventory_movements", ["order_id"])

    for table_name in ("orders", "order_items", "payments", "inventory_movements"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table_name} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )


def downgrade() -> None:
    for table_name in ("inventory_movements", "payments", "order_items", "orders"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
    op.drop_table("inventory_movements")
    op.drop_table("payments")
    op.drop_table("order_items")
    op.drop_table("orders")

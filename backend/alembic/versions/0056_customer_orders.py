"""add operational customer orders and inventory reservations

Revision ID: 0056_customer_orders
Revises: 0055_trusted_anonymous_telemetry
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0056_customer_orders"
down_revision: str | None = "0055_trusted_anonymous_telemetry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_PERMISSIONS = (
    "customer_orders.view",
    "customer_orders.create",
    "customer_orders.update",
    "customer_orders.cancel",
    "customer_orders.checkout",
)


def _enable_tenant_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )


def upgrade() -> None:
    op.create_table(
        "customer_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("folio", sa.String(length=12), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("fulfillment_type", sa.String(length=16), nullable=False),
        sa.Column("source_channel", sa.String(length=24), nullable=False),
        sa.Column("customer_name", sa.String(length=160), nullable=True),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("delivery_address", sa.String(length=300), nullable=True),
        sa.Column("delivery_reference", sa.String(length=200), nullable=True),
        sa.Column("promised_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("subtotal_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("cancelled_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=32), nullable=True),
        sa.Column("cancellation_note", sa.String(length=300), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('new', 'confirmed', 'in_progress', 'ready', 'fulfilled', 'cancelled')",
            name="ck_customer_orders_status",
        ),
        sa.CheckConstraint(
            "fulfillment_type IN ('pickup', 'delivery')",
            name="ck_customer_orders_fulfillment_type",
        ),
        sa.CheckConstraint(
            "source_channel IN ('counter', 'phone_whatsapp', 'other')",
            name="ck_customer_orders_source_channel",
        ),
        sa.CheckConstraint(
            "subtotal_amount >= 0 AND total_amount >= 0",
            name="ck_customer_orders_totals_nonnegative",
        ),
        sa.CheckConstraint("version > 0", name="ck_customer_orders_version_positive"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sale_order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["cancelled_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "folio", name="uq_customer_orders_tenant_folio"),
        sa.UniqueConstraint("sale_order_id", name="uq_customer_orders_sale_order_id"),
    )
    op.create_index("ix_customer_orders_tenant_id", "customer_orders", ["tenant_id"])
    op.create_index(
        "ix_customer_orders_tenant_status", "customer_orders", ["tenant_id", "status"]
    )
    op.create_index(
        "ix_customer_orders_tenant_promised", "customer_orders", ["tenant_id", "promised_at"]
    )
    op.create_index(
        "ix_customer_orders_tenant_created", "customer_orders", ["tenant_id", "created_at"]
    )

    op.create_table(
        "customer_order_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("customer_order_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("product_name", sa.String(length=160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.CheckConstraint("quantity > 0", name="ck_customer_order_items_quantity_positive"),
        sa.CheckConstraint(
            "unit_price_amount >= 0 AND line_total_amount >= 0",
            name="ck_customer_order_items_amounts_nonnegative",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["customer_order_id"], ["customer_orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_order_items_tenant_id", "customer_order_items", ["tenant_id"])
    op.create_index(
        "ix_customer_order_items_order", "customer_order_items", ["customer_order_id"]
    )
    op.create_index(
        "ix_customer_order_items_product", "customer_order_items", ["tenant_id", "product_id"]
    )

    op.create_table(
        "customer_order_item_modifiers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("customer_order_item_id", sa.Uuid(), nullable=False),
        sa.Column("modifier_group_id", sa.Uuid(), nullable=False),
        sa.Column("modifier_group_name", sa.String(length=120), nullable=False),
        sa.Column("modifier_option_id", sa.Uuid(), nullable=False),
        sa.Column("modifier_option_name", sa.String(length=120), nullable=False),
        sa.Column("price_delta_amount", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["customer_order_item_id"], ["customer_order_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["modifier_group_id"], ["modifier_groups.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["modifier_option_id"], ["modifier_options.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_customer_order_item_modifiers_tenant_id",
        "customer_order_item_modifiers",
        ["tenant_id"],
    )
    op.create_index(
        "ix_customer_order_item_modifiers_item",
        "customer_order_item_modifiers",
        ["customer_order_item_id"],
    )

    op.create_table(
        "inventory_reservations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("customer_order_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_reservations_quantity_positive"),
        sa.CheckConstraint(
            "status IN ('active', 'consumed', 'released')",
            name="ck_inventory_reservations_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["customer_order_id"], ["customer_orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "customer_order_id", "product_id", name="uq_inventory_reservations_order_product"
        ),
    )
    op.create_index("ix_inventory_reservations_tenant_id", "inventory_reservations", ["tenant_id"])
    op.create_index(
        "ix_inventory_reservations_product_status",
        "inventory_reservations",
        ["tenant_id", "product_id", "status"],
    )

    for table in (
        "customer_orders",
        "customer_order_items",
        "customer_order_item_modifiers",
        "inventory_reservations",
    ):
        _enable_tenant_rls(table)

    for permission in _PERMISSIONS:
        op.execute(sa.text("INSERT INTO permissions (name) VALUES (:name)").bindparams(name=permission))
        for role in ("owner", "manager", "cashier", "staff"):
            op.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "SELECT r.id, p.id FROM roles r, permissions p "
                    "WHERE r.name = :role AND p.name = :permission"
                ).bindparams(role=role, permission=permission)
            )


def downgrade() -> None:
    for permission in _PERMISSIONS:
        op.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE name = :name)"
            ).bindparams(name=permission)
        )
        op.execute(sa.text("DELETE FROM permissions WHERE name = :name").bindparams(name=permission))

    for table in (
        "inventory_reservations",
        "customer_order_item_modifiers",
        "customer_order_items",
        "customer_orders",
    ):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)

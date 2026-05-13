"""add modifier groups, options, product assignments, and order item modifiers

Revision ID: 0014_modifiers
Revises: 0013_rls_policy_cleanup
Create Date: 2026-05-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_modifiers"
down_revision: str | None = "0013_rls_policy_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "modifier_groups",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tenant_id", sa.UUID(), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("min_selections", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_selections", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "name", name="uq_modifier_groups_tenant_name"),
    )

    op.create_table(
        "modifier_options",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tenant_id", sa.UUID(), nullable=False, index=True),
        sa.Column("group_id", sa.UUID(), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("price_delta", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "product_modifier_groups",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), nullable=False, index=True),
        sa.Column("modifier_group_id", sa.UUID(), nullable=False, index=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint(
            "product_id", "modifier_group_id", name="uq_product_modifier_groups"
        ),
    )

    op.create_table(
        "order_item_modifiers",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tenant_id", sa.UUID(), nullable=False, index=True),
        sa.Column("order_item_id", sa.UUID(), nullable=False, index=True),
        sa.Column("modifier_group_id", sa.UUID(), nullable=False),
        sa.Column("modifier_group_name", sa.String(120), nullable=False),
        sa.Column("modifier_option_id", sa.UUID(), nullable=False),
        sa.Column("modifier_option_name", sa.String(120), nullable=False),
        sa.Column("price_delta_amount", sa.Numeric(12, 4), nullable=False),
    )

    # RLS
    for table in ("modifier_groups", "modifier_options"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )

    op.execute("ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON order_item_modifiers "
        "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
    )


def downgrade() -> None:
    for table in ("order_item_modifiers", "product_modifier_groups", "modifier_options", "modifier_groups"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)

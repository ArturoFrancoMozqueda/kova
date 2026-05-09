"""add refunds and voids tables

Revision ID: 0009_refunds_voids
Revises: 0008_order_client_uuid
Create Date: 2026-05-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_refunds_voids"
down_revision: str | None = "0008_order_client_uuid"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "refunds",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("reason", sa.String(30), nullable=False),
        sa.Column("refunded_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
    )
    op.create_index("ix_refunds_tenant_id", "refunds", ["tenant_id"])
    op.create_index("ix_refunds_order_id", "refunds", ["order_id"])

    op.create_table(
        "refund_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("refund_id", sa.UUID(), nullable=False),
        sa.Column("order_item_id", sa.UUID(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total_amount", sa.Numeric(12, 2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["refund_id"], ["refunds.id"]),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"]),
    )
    op.create_index("ix_refund_items_refund_id", "refund_items", ["refund_id"])
    op.create_index("ix_refund_items_order_item_id", "refund_items", ["order_item_id"])

    op.create_table(
        "voids",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("reason", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
    )
    op.create_index("ix_voids_tenant_id", "voids", ["tenant_id"])
    op.create_index("ix_voids_order_id", "voids", ["order_id"])


def downgrade() -> None:
    op.drop_table("voids")
    op.drop_table("refund_items")
    op.drop_table("refunds")

"""add order client uuid for offline sync

Revision ID: 0008_order_client_uuid
Revises: 0007_orders
Create Date: 2026-05-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_order_client_uuid"
down_revision: str | None = "0007_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("client_uuid", sa.UUID(), nullable=True))
    op.create_unique_constraint(
        "uq_orders_tenant_client_uuid",
        "orders",
        ["tenant_id", "client_uuid"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_orders_tenant_client_uuid", "orders", type_="unique")
    op.drop_column("orders", "client_uuid")

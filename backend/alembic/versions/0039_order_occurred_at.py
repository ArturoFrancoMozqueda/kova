"""add orders.occurred_at (client ring-time)

Offline sales are rung on the device and synced later. Until now the order was
stamped with created_at at INSERT (sync time), so a sale rung at 23:50 that
synced at 00:10 landed in the next day's report and could not be reconciled
against the paper close.

This adds a nullable orders.occurred_at (the client ring-time) and backfills it
to created_at for every existing row. Existing rows were online sales, so their
ring-time equals created_at and reports are unchanged. Reports and order-list
day-bounds read occurred_at (falling back to created_at) so late-synced offline
sales report on the day they were actually rung.

Expand-and-contract: nullable first so old clients that don't send occurred_at
keep working (the app layer defaults it to server-now). A later contract
migration can set NOT NULL once every writer populates it.

Revision ID: 0039_order_occurred_at
Revises: 0038_tenant_visibility_rls
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0039_order_occurred_at"
down_revision: str | None = "0038_tenant_visibility_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill: existing orders were online sales, so ring-time == created_at.
    op.execute("UPDATE orders SET occurred_at = created_at WHERE occurred_at IS NULL")
    # Reports and order-list filter/sort orders by tenant + sale time.
    op.create_index(
        "ix_orders_tenant_occurred_at",
        "orders",
        ["tenant_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_orders_tenant_occurred_at", table_name="orders")
    op.drop_column("orders", "occurred_at")

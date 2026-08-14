"""add billing event watermarks

Revision ID: 20e47faf64eb
Revises: 0056_customer_orders
Create Date: 2026-08-13 19:43:59.787025

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20e47faf64eb"
down_revision: str | None = "0056_customer_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable columns make this safe for a rolling deploy: the previous app
    # version ignores them and pre-existing rows bootstrap on their first
    # timestamped Stripe event.
    op.add_column(
        "subscriptions",
        sa.Column("stripe_lifecycle_watermark_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("stripe_lifecycle_event_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("stripe_lifecycle_event_type", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("stripe_payment_watermark_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("stripe_payment_event_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("stripe_payment_event_type", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "stripe_payment_event_type")
    op.drop_column("subscriptions", "stripe_payment_event_id")
    op.drop_column("subscriptions", "stripe_payment_watermark_at")
    op.drop_column("subscriptions", "stripe_lifecycle_event_type")
    op.drop_column("subscriptions", "stripe_lifecycle_event_id")
    op.drop_column("subscriptions", "stripe_lifecycle_watermark_at")

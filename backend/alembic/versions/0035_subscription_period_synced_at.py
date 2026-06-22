"""track subscription period sync time

Revision ID: 0035_sub_period_sync
Revises: 0034_normalize_user_emails
Create Date: 2026-06-22 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0035_sub_period_sync"
down_revision: str | None = "0034_normalize_user_emails"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("stripe_period_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "stripe_period_synced_at")

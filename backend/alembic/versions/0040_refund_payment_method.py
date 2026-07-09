"""add refunds.refund_payment_method

Persist the tender a refund was paid back through (cash / bank_transfer /
manual_card). Previously the method was a transient request field used only to
decide whether to post a cash drawer movement; it was never stored, so refunds
could not be validated against what was actually collected per method, and the
payment-mix report could not net refunds by method.

Nullable + no backfill keeps it backward compatible: pre-existing refunds keep
method NULL and are simply excluded from per-method ceilings and per-method
report netting (they still reduce the overall refund/net totals). Every new
refund populates it.

Revision ID: 0040_refund_payment_method
Revises: 0039_order_occurred_at
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0040_refund_payment_method"
down_revision: str | None = "0039_order_occurred_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "refunds",
        sa.Column("refund_payment_method", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("refunds", "refund_payment_method")

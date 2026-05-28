"""add incomplete_expired to subscriptions.status check constraint

Revision ID: 0026_incomplete_expired_status
Revises: 0025_trial_reminder_sent_at
Create Date: 2026-05-28 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0026_incomplete_expired_status"
down_revision: str | None = "0025_trial_reminder_sent_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_subscriptions_status", "subscriptions", type_="check")
    op.create_check_constraint(
        "ck_subscriptions_status",
        "subscriptions",
        "status IN ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_subscriptions_status", "subscriptions", type_="check")
    op.create_check_constraint(
        "ck_subscriptions_status",
        "subscriptions",
        "status IN ('incomplete','trialing','active','past_due','canceled','unpaid')",
    )

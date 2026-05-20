"""standard plan 299 mxn

Revision ID: 0023_standard_plan_299_mxn
Revises: 0022_telemetry_events
Create Date: 2026-05-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0023_standard_plan_299_mxn"
down_revision: str | None = "0022_telemetry_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "subscriptions",
        "amount_minor_units",
        existing_type=sa.Integer(),
        server_default="29900",
        existing_nullable=False,
    )
    op.execute(
        "UPDATE subscriptions SET amount_minor_units = 29900 "
        "WHERE plan_name = 'Standard Plan' AND amount_minor_units = 19900"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE subscriptions SET amount_minor_units = 19900 "
        "WHERE plan_name = 'Standard Plan' AND amount_minor_units = 29900"
    )
    op.alter_column(
        "subscriptions",
        "amount_minor_units",
        existing_type=sa.Integer(),
        server_default="19900",
        existing_nullable=False,
    )

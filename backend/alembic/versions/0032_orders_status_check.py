"""constrain orders.status to known values

orders.status was a free String. Add a CHECK so only 'completed' / 'voided'
are storable — a typo'd status would otherwise silently drop the order out of
every report (which filters status = 'completed'). All existing rows already
use these two values.

Revision ID: 0032_orders_status_check
Revises: 0031_audit_log_indexes
Create Date: 2026-06-11 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0032_orders_status_check"
down_revision: str | None = "0031_audit_log_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_orders_status",
        "orders",
        "status IN ('completed', 'voided')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_orders_status", "orders", type_="check")

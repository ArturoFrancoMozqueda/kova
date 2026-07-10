"""enforce a single open shift per tenant

The app checked "is a shift already open?" before creating one, but that check
loses a race: two concurrent opens (double-tap, retry) can both read "none open"
and both insert, creating two drawers so cash attributes ambiguously and the
corte de caja is undefined.

This adds a partial unique index so the database guarantees at most one open
shift per tenant. Concurrent opens now surface an IntegrityError which the
service maps to 409.

Because the index would fail to build if any tenant already has >1 open shift,
we first repair existing data: keep the most recently opened shift per tenant
and close the older duplicates (status='closed', closed_at=now()). This is
non-destructive — the extra drawers are simply closed, not deleted.

Revision ID: 0041_single_open_shift
Revises: 0040_refund_payment_method
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0041_single_open_shift"
down_revision: str | None = "0040_refund_payment_method"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Repair: for any tenant with more than one open shift, keep the most
    # recently opened one and close the rest so the unique index can be built.
    op.execute(
        """
        UPDATE shifts
        SET status = 'closed', closed_at = now()
        WHERE status = 'open'
          AND id NOT IN (
              SELECT DISTINCT ON (tenant_id) id
              FROM shifts
              WHERE status = 'open'
              ORDER BY tenant_id, opened_at DESC
          )
        """
    )
    op.create_index(
        "uq_one_open_shift_per_tenant",
        "shifts",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_index("uq_one_open_shift_per_tenant", table_name="shifts")

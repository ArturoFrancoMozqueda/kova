"""normalize existing user emails to lowercase

Revision ID: 0034_normalize_user_emails
Revises: 0033_product_image_zoom
Create Date: 2026-06-21 00:00:00.000000

The app now normalizes emails to ``strip().lower()`` at the API boundary so a single
address can't create distinct accounts or bypass the "email already in use" check.
This backfills any pre-existing mixed-case rows to match.

If two existing rows collapse to the same lowercase address (e.g. ``A@x.com`` and
``a@x.com``), the migration aborts with the offending addresses instead of silently
merging or dropping data — those duplicate accounts must be resolved manually first.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import text

from alembic import op

revision: str = "0034_normalize_user_emails"
down_revision: str | None = "0033_product_image_zoom"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    collisions = conn.execute(
        text(
            """
            SELECT lower(email) AS norm, count(*) AS n
            FROM users
            GROUP BY lower(email)
            HAVING count(*) > 1
            """
        )
    ).fetchall()
    if collisions:
        offenders = ", ".join(f"{row.norm} (x{row.n})" for row in collisions)
        raise RuntimeError(
            "Cannot normalize user emails: case-only duplicate accounts exist and must "
            f"be merged/removed manually before re-running this migration: {offenders}"
        )

    conn.execute(
        text("UPDATE users SET email = lower(trim(email)) WHERE email <> lower(trim(email))")
    )

    # Enforce case-insensitive uniqueness at the DB layer, not just at the API
    # boundary — any write path that skips normalization (or a future regression)
    # still can't create a case-variant duplicate account.
    op.create_index(
        "uq_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
    )


def downgrade() -> None:
    # Lowercasing is not reversible (original casing is unrecoverable); only the
    # index is dropped. IF EXISTS keeps the migration safely re-runnable.
    op.execute("DROP INDEX IF EXISTS uq_users_email_lower")

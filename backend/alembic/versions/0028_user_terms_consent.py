"""user terms/privacy consent

Records the timestamp and IP at which a user accepted the privacy and terms
of service. Required for LFPDPPP / GDPR evidence: who consented, when, from
where. Nullable for backfill of users created before the checkbox was added.

Revision ID: 0028_user_terms_consent
Revises: 0027_invitation_tokens
Create Date: 2026-05-28 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0028_user_terms_consent"
down_revision: str | None = "0027_invitation_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("terms_accepted_ip", sa.String(length=45), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_ip")
    op.drop_column("users", "terms_accepted_at")

"""founder TOTP MFA for Kova Ops

Revision ID: 0061_ops_founder_mfa
Revises: 0060_ops_notes_incident_states
Create Date: 2026-08-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0061_ops_founder_mfa"
down_revision: str | None = "0060_ops_notes_incident_states"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("ops_mfa_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "ops_mfa_factors",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_used_counter", sa.BigInteger(), nullable=False),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "ops_mfa_recovery_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        "ix_ops_mfa_recovery_codes_user_id",
        "ops_mfa_recovery_codes",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ops_mfa_recovery_codes_user_id", table_name="ops_mfa_recovery_codes")
    op.drop_table("ops_mfa_recovery_codes")
    op.drop_table("ops_mfa_factors")
    op.drop_column("sessions", "ops_mfa_verified_at")

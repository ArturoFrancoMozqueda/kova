"""sessions and verification tokens

Revision ID: 0004_sessions_tokens
Revises: 0003_rbac
Create Date: 2026-05-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_sessions_tokens"
down_revision: str | None = "0003_rbac"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.UUID(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("refresh_token_hash", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("refresh_token_hash", name="uq_sessions_refresh_token_hash"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_index("ix_sessions_tenant_id", "sessions", ["tenant_id"])

    op.execute("ALTER TABLE sessions ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON sessions "
        "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
    )

    op.create_table(
        "verification_tokens",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("token_type", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_verification_tokens_hash"),
        sa.CheckConstraint(
            "token_type IN ('email_verification','password_reset')",
            name="ck_verification_tokens_type",
        ),
    )
    op.create_index("ix_verification_tokens_user_id", "verification_tokens", ["user_id"])


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON sessions")
    op.drop_table("verification_tokens")
    op.drop_table("sessions")

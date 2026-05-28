"""add token + expires_at to membership_invitations

Revision ID: 0027_invitation_tokens
Revises: 0026_incomplete_expired_status
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0027_invitation_tokens"
down_revision: str | None = "0026_incomplete_expired_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "membership_invitations",
        sa.Column("token_hash", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "membership_invitations",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Mark any legacy pending invitations as revoked — they have no token and
    # can never be accepted via the new flow.
    op.execute(
        "UPDATE membership_invitations "
        "SET status = 'revoked', revoked_at = now() "
        "WHERE status = 'pending'"
    )
    op.create_index(
        "ix_membership_invitations_token_hash",
        "membership_invitations",
        ["token_hash"],
        unique=True,
    )
    # Token-based accept flow must work without a session (the invitee is
    # unauthenticated when clicking the email link), so we drop the tenant
    # RLS policy. Tenant isolation for invitation reads/writes is enforced
    # at the application layer (every list/create call filters by the
    # caller's membership.tenant_id), matching the pattern used by
    # `verification_tokens`.
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON membership_invitations")


def downgrade() -> None:
    op.execute(
        "CREATE POLICY tenant_isolation ON membership_invitations "
        "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
    )
    op.drop_index(
        "ix_membership_invitations_token_hash",
        table_name="membership_invitations",
    )
    op.drop_column("membership_invitations", "expires_at")
    op.drop_column("membership_invitations", "token_hash")

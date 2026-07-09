"""scope users visibility through tenant memberships

Revision ID: 0037_users_membership_rls
Revises: 0036_force_rls
Create Date: 2026-07-09

`users` is global identity data, so it does not carry a tenant_id column. Once
the runtime app role moved to `kova_app`, production exposed that RLS may be
enabled on `users` with no policy, making authenticated session probes unable
to load the current user after login.

This policy keeps user rows tenant-scoped indirectly: a runtime connection can
read only users who have an active membership in the current tenant context.
Pre-session auth and password reset paths continue to use the privileged engine.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0037_users_membership_rls"
down_revision: str | None = "0036_force_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_membership_visibility ON users")
    op.execute(
        """
        CREATE POLICY tenant_membership_visibility ON users
        FOR SELECT
        USING (
            EXISTS (
                SELECT 1
                FROM memberships
                WHERE memberships.user_id = users.id
                  AND memberships.is_active IS TRUE
                  AND memberships.tenant_id = current_setting('app.tenant_id', true)::uuid
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_membership_visibility ON users")

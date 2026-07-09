"""scope tenants visibility to the current tenant context

Revision ID: 0038_tenant_visibility_rls
Revises: 0037_users_membership_rls
Create Date: 2026-07-09

Runtime session probes read the tenant row after authenticating so the frontend
can show the business name in navigation. Production had RLS enabled on
`tenants` without a runtime policy, which made that lookup return nothing for
`kova_app`.

This grants read visibility only to the tenant id already present in the signed
JWT. It also rewrites the `users` membership policy to compare UUIDs as text so
no-context reads deny cleanly instead of casting an empty setting to uuid.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0038_tenant_visibility_rls"
down_revision: str | None = "0037_users_membership_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS current_tenant_visibility ON tenants")
    op.execute(
        """
        CREATE POLICY current_tenant_visibility ON tenants
        FOR SELECT
        USING (id::text = current_setting('app.tenant_id', true))
        """
    )

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
                  AND memberships.tenant_id::text = current_setting('app.tenant_id', true)
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS current_tenant_visibility ON tenants")
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

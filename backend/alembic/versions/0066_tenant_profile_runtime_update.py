"""allow tenant-scoped public-name updates from the runtime role

Revision ID: 0066_tenant_profile_update
Revises: 0065_tenant_relations_grants
Create Date: 2026-09-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0066_tenant_profile_update"
down_revision: str | None = "0065_tenant_relations_grants"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP POLICY IF EXISTS current_tenant_name_update ON tenants")
    op.execute(
        """
        CREATE POLICY current_tenant_name_update ON tenants
        FOR UPDATE TO PUBLIC
        USING (id::text = current_setting('app.tenant_id', true))
        WITH CHECK (id::text = current_setting('app.tenant_id', true))
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                REVOKE UPDATE ON TABLE tenants FROM kova_app;
                GRANT UPDATE (name, updated_at) ON TABLE tenants TO kova_app;
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                REVOKE UPDATE (name, updated_at) ON TABLE tenants FROM kova_app;
            END IF;
        END
        $$
        """
    )
    op.execute("DROP POLICY IF EXISTS current_tenant_name_update ON tenants")

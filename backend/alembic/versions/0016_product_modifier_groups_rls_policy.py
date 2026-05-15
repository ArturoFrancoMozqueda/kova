"""add derived tenant RLS policy for product modifier assignments

Revision ID: 0016_pmg_rls_policy
Revises: 0015_modifier_price_precision
Create Date: 2026-05-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0016_pmg_rls_policy"
down_revision: str | None = "0015_modifier_price_precision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE product_modifier_groups ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_modifier_groups")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON product_modifier_groups
        USING (
            EXISTS (
                SELECT 1
                FROM products p
                JOIN modifier_groups mg
                    ON mg.id = product_modifier_groups.modifier_group_id
                WHERE p.id = product_modifier_groups.product_id
                    AND p.tenant_id = current_setting('app.tenant_id', true)::uuid
                    AND mg.tenant_id = p.tenant_id
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM products p
                JOIN modifier_groups mg
                    ON mg.id = product_modifier_groups.modifier_group_id
                WHERE p.id = product_modifier_groups.product_id
                    AND p.tenant_id = current_setting('app.tenant_id', true)::uuid
                    AND mg.tenant_id = p.tenant_id
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_modifier_groups")

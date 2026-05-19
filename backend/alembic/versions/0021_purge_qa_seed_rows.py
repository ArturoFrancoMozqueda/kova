"""purge leaked QA catalog seed rows

Revision ID: 0021_purge_qa_seed_rows
Revises: 0020_tenant_logo_files
Create Date: 2026-05-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0021_purge_qa_seed_rows"
down_revision: str | None = "0020_tenant_logo_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE products p
        SET is_active = false,
            sku = CASE WHEN p.sku = 'QA-CON-20260512' THEN NULL ELSE p.sku END,
            updated_at = now()
        WHERE (
                p.sku = 'QA-CON-20260512'
                OR p.name = 'QA Concha 20260512'
                OR p.name = 'Dona'
            )
            AND EXISTS (
                SELECT 1
                FROM order_items oi
                WHERE oi.product_id = p.id
            )
        """
    )
    op.execute(
        """
        DELETE FROM products p
        WHERE p.sku = 'QA-CON-20260512'
            OR p.name = 'QA Concha 20260512'
            OR (
                p.name = 'Dona'
                AND NOT EXISTS (
                    SELECT 1
                    FROM order_items oi
                    WHERE oi.product_id = p.id
                )
            )
        """
    )


def downgrade() -> None:
    pass

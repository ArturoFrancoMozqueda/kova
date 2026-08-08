"""make products RLS deny empty tenant context without uuid casts

Revision ID: 0054_products_rls_empty_context
Revises: 0053_landing_conversion_events
Create Date: 2026-08-07

``app.tenant_id`` is transaction-local. After a commit PostgreSQL exposes the
setting as an empty string on the pooled connection. The previous policy cast
that value to UUID, turning a safe deny-by-default condition into a production
``InvalidTextRepresentation`` error during an accidental post-commit query.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0054_products_rls_empty_context"
down_revision: str | None = "0053_landing_conversion_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "products"
_TEXT_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_UUID_TENANT_QUAL = "tenant_id = current_setting('app.tenant_id', true)::uuid"


def upgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {_TABLE}")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {_TABLE} "
        f"USING ({_TEXT_TENANT_QUAL}) WITH CHECK ({_TEXT_TENANT_QUAL})"
    )


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {_TABLE}")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {_TABLE} "
        f"USING ({_UUID_TENANT_QUAL}) WITH CHECK ({_UUID_TENANT_QUAL})"
    )

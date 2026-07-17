"""make receipt settings RLS deny empty tenant context without uuid casts

Revision ID: 0045_receipt_rls_empty_context
Revises: 0044_billing_rls_empty_context
Create Date: 2026-07-16

``app.tenant_id`` is transaction-local. After a commit PostgreSQL exposes the
setting as an empty string on the pooled connection, so a subsequent ORM
refresh must be denied by RLS instead of failing while casting ``""`` to UUID.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0045_receipt_rls_empty_context"
down_revision: str | None = "0044_billing_rls_empty_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TEXT_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_UUID_TENANT_QUAL = "tenant_id = current_setting('app.tenant_id', true)::uuid"
_TABLE = "tenant_receipt_settings"


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

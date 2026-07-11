"""make billing RLS deny empty tenant context without uuid casts

Revision ID: 0044_billing_rls_empty_context
Revises: 0043_anon_telemetry_rls
Create Date: 2026-07-11

Billing reads can run on pooled connections where ``app.tenant_id`` exists as
an empty string before the request dependency sets a real tenant context. The
old policy cast that setting to uuid, so Postgres raised
``invalid input syntax for type uuid: ""`` before it could simply deny rows.

Compare UUID columns as text instead. A missing or empty tenant context now
evaluates false, preserving isolation while avoiding a production 500.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0044_billing_rls_empty_context"
down_revision: str | None = "0043_anon_telemetry_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TEXT_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_UUID_TENANT_QUAL = "tenant_id = current_setting('app.tenant_id', true)::uuid"
_BILLING_TABLES = ("subscriptions", "webhook_events")


def upgrade() -> None:
    for table in _BILLING_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING ({_TEXT_TENANT_QUAL}) WITH CHECK ({_TEXT_TENANT_QUAL})"
        )


def downgrade() -> None:
    for table in _BILLING_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING ({_UUID_TENANT_QUAL}) WITH CHECK ({_UUID_TENANT_QUAL})"
        )

"""index audit_logs for tenant feed and per-resource history

audit_logs had no indexes, so "show this tenant's recent activity" and
"history of changes for resource X" scanned the whole table. Add two composite
indexes. Purely additive and backward compatible.

Revision ID: 0031_audit_log_indexes
Revises: 0030_order_shift_link
Create Date: 2026-06-11 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0031_audit_log_indexes"
down_revision: str | None = "0030_order_shift_link"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_audit_logs_tenant_created",
        "audit_logs",
        ["tenant_id", "created_at"],
    )
    op.create_index(
        "ix_audit_logs_tenant_resource",
        "audit_logs",
        ["tenant_id", "resource_type", "resource_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_logs_tenant_resource", table_name="audit_logs")
    op.drop_index("ix_audit_logs_tenant_created", table_name="audit_logs")

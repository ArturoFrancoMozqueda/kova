"""add deferred account deletion requests

Revision ID: 0050_account_deletions
Revises: 0049_operating_expenses
Create Date: 2026-07-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0050_account_deletions"
down_revision: str | None = "0049_operating_expenses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"


def upgrade() -> None:
    op.create_table(
        "account_deletion_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        # Intentionally not a FK: the minimized tombstone is retained after the
        # tenant is purged as evidence that the request completed.
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("purge_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','canceled','completed')",
            name="ck_account_deletion_requests_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_account_deletion_requests_tenant_id"),
    )
    op.create_index(
        "ix_account_deletion_requests_tenant_id",
        "account_deletion_requests",
        ["tenant_id"],
    )
    op.create_index(
        "ix_account_deletion_requests_due",
        "account_deletion_requests",
        ["status", "purge_after"],
    )
    op.execute("ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE account_deletion_requests FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON account_deletion_requests "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON account_deletion_requests")
    op.drop_index("ix_account_deletion_requests_due", table_name="account_deletion_requests")
    op.drop_index(
        "ix_account_deletion_requests_tenant_id", table_name="account_deletion_requests"
    )
    op.drop_table("account_deletion_requests")

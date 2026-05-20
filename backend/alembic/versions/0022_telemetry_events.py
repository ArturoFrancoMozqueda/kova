"""telemetry events

Revision ID: 0022_telemetry_events
Revises: 0021_purge_qa_seed_rows
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_telemetry_events"
down_revision: str | None = "0021_purge_qa_seed_rows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "telemetry_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_name", sa.String(length=120), nullable=False),
        sa.Column("client_event_id", sa.String(length=80), nullable=False),
        sa.Column("properties", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "client_event_id", name="uq_telemetry_tenant_client_event"),
    )
    op.create_index("ix_telemetry_events_tenant_id", "telemetry_events", ["tenant_id"])
    op.create_index("ix_telemetry_events_user_id", "telemetry_events", ["user_id"])
    op.create_index("ix_telemetry_events_event_name", "telemetry_events", ["event_name"])
    op.execute("ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY telemetry_events_tenant_isolation
        ON telemetry_events
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS telemetry_events_tenant_isolation ON telemetry_events")
    op.drop_index("ix_telemetry_events_event_name", table_name="telemetry_events")
    op.drop_index("ix_telemetry_events_user_id", table_name="telemetry_events")
    op.drop_index("ix_telemetry_events_tenant_id", table_name="telemetry_events")
    op.drop_table("telemetry_events")

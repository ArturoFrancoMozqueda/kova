"""ops notes and incident triage states

Internal ops dashboard tables. Not tenant-scoped → no RLS, same posture as
audit_logs/webhook_events; access is restricted to internal-admin endpoints.

Revision ID: 0060_ops_notes_incident_states
Revises: 0059_fiscal_report_idx, 20e47faf64eb
Create Date: 2026-08-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0060_ops_notes_incident_states"
down_revision: str | tuple[str, str] | None = (
    "0059_fiscal_report_idx",
    "20e47faf64eb",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ops_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("author_user_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("entity_source", sa.String(length=40), nullable=True),
        sa.Column("entity_external_id", sa.String(length=255), nullable=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "entity_type IN ('incident','tenant','general')",
            name="ck_ops_notes_entity_type",
        ),
        sa.CheckConstraint(
            "status IN ('open','resolved','archived')",
            name="ck_ops_notes_status",
        ),
    )
    op.create_index(
        "ix_ops_notes_entity",
        "ops_notes",
        ["entity_type", "entity_source", "entity_external_id"],
    )
    op.create_index("ix_ops_notes_tenant_id", "ops_notes", ["tenant_id"])

    op.create_table(
        "ops_incident_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column(
            "triage_status", sa.String(length=20), nullable=False, server_default="new"
        ),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "source IN ('stripe_webhook','subscription','sentry','uptimerobot','fly','vercel','db')",
            name="ck_ops_incident_states_source",
        ),
        sa.CheckConstraint(
            "triage_status IN ('new','acknowledged','investigating','resolved','ignored')",
            name="ck_ops_incident_states_triage",
        ),
        sa.UniqueConstraint(
            "source", "external_id", name="uq_ops_incident_states_source_external"
        ),
    )


def downgrade() -> None:
    op.drop_table("ops_incident_states")
    op.drop_index("ix_ops_notes_tenant_id", table_name="ops_notes")
    op.drop_index("ix_ops_notes_entity", table_name="ops_notes")
    op.drop_table("ops_notes")

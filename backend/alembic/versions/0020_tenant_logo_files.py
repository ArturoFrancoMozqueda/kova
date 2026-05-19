"""add tenant logo file storage

Revision ID: 0020_tenant_logo_files
Revises: 0019_modifier_integrity
Create Date: 2026-05-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0020_tenant_logo_files"
down_revision: str | None = "0019_modifier_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenant_logo_files",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            sa.UUID(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("bytes_data", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_logo_files_tenant_id"),
    )
    op.create_index("ix_tenant_logo_files_tenant_id", "tenant_logo_files", ["tenant_id"])
    op.create_check_constraint(
        "ck_tenant_logo_files_byte_size_non_negative",
        "tenant_logo_files",
        "byte_size >= 0",
    )
    op.execute("ALTER TABLE tenant_logo_files ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON tenant_logo_files")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON tenant_logo_files
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON tenant_logo_files")
    op.drop_table("tenant_logo_files")

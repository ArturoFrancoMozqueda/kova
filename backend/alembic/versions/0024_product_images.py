"""add product image storage

Revision ID: 0024_product_images
Revises: 0023_standard_plan_299_mxn
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0024_product_images"
down_revision: str | None = "0023_standard_plan_299_mxn"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("image_url", sa.String(length=1000), nullable=True),
    )

    op.create_table(
        "product_image_files",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "tenant_id",
            sa.UUID(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            sa.UUID(),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
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
        sa.UniqueConstraint("product_id", name="uq_product_image_files_product_id"),
    )
    op.create_index("ix_product_image_files_tenant_id", "product_image_files", ["tenant_id"])
    op.create_check_constraint(
        "ck_product_image_files_byte_size_non_negative",
        "product_image_files",
        "byte_size >= 0",
    )
    op.execute("ALTER TABLE product_image_files ENABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_image_files")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON product_image_files
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_image_files")
    op.drop_table("product_image_files")
    op.drop_column("products", "image_url")

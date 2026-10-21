"""Bounded, disposable product thumbnail cache on the existing image owner row."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0092_product_image_thumbnails"
down_revision = "0091_case_deadline_automation"
branch_labels = None
depends_on = None


def upgrade():
    # Nullable with no default/backfill: original photos and their versions,
    # ownership, RLS policies and existing grants remain unchanged.
    op.add_column(
        "product_image_files",
        sa.Column("thumbnail_variants", postgresql.JSONB(none_as_null=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_product_image_thumbnail_variants",
        "product_image_files",
        "thumbnail_variants IS NULL OR CASE "
        "WHEN jsonb_typeof(thumbnail_variants) = 'object' THEN "
        "(thumbnail_variants - ARRAY['160','320','400','800']::text[]) = '{}'::jsonb "
        "AND octet_length(thumbnail_variants::text) <= 1048576 ELSE false END",
    )


def downgrade():
    # Only disposable derived bytes are removed; original business data stays.
    op.drop_constraint(
        "ck_product_image_thumbnail_variants", "product_image_files", type_="check",
    )
    op.drop_column("product_image_files", "thumbnail_variants")

"""managed cfdi enrollment

Revision ID: e9f2d5d835e6
Revises: 0077_inventory_lots
Create Date: 2026-10-09 09:00:18.497374

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e9f2d5d835e6"
down_revision: str | None = "0077_inventory_lots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():
    op.create_table(
        "cfdi_enrollments",
        sa.Column("tenant_id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.String(100)),
        sa.Column("issuer_snapshot", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("operation_id", sa.Uuid()),
        sa.Column("creation_rejected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("last_error_code", sa.String(80)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.UniqueConstraint("organization_id", name="uq_cfdi_enrollment_organization"),
        sa.CheckConstraint(
            "state IN ('creating','unknown','configured','error')", name="ck_cfdi_enrollment_state"
        ),
    )
    op.execute("""
        ALTER TABLE cfdi_enrollments ENABLE ROW LEVEL SECURITY;
        ALTER TABLE cfdi_enrollments FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON cfdi_enrollments FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        REVOKE ALL ON cfdi_enrollments FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON cfdi_enrollments FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON cfdi_enrollments FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
                GRANT SELECT, INSERT ON cfdi_enrollments TO kova_app;
                GRANT UPDATE (organization_id, issuer_snapshot, state, operation_id, creation_rejected, last_error_code, updated_at) ON cfdi_enrollments TO kova_app;
            END IF;
        END $$;
    """)


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM cfdi_enrollments) THEN
            RAISE EXCEPTION 'Cannot erase managed fiscal enrollment journal';
        END IF;
    END $$;""")
    op.drop_table("cfdi_enrollments")

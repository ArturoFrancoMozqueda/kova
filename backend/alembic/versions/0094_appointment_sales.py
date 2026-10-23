"""Immutable appointment attribution to an existing customer sale."""

import sqlalchemy as sa

from alembic import op

revision = "0094_appointment_sales"
down_revision = "0093_readable_catalog_links"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "appointment_sales",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("appointment_id", name="uq_appointment_sale_appointment"),
        sa.UniqueConstraint("sale_order_id", name="uq_appointment_sale_order"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "appointment_id"],
            ["appointments.tenant_id", "appointments.branch_id", "appointments.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"],
            ["memberships.tenant_id", "memberships.user_id"],
        ),
    )
    op.create_index("ix_appointment_sales_tenant_id", "appointment_sales", ["tenant_id"])
    op.create_index("ix_appointment_sales_branch_id", "appointment_sales", ["branch_id"])
    op.execute("ALTER TABLE appointment_sales ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE appointment_sales FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation ON appointment_sales FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute("REVOKE ALL ON appointment_sales FROM PUBLIC")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON appointment_sales FROM anon; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON appointment_sales FROM authenticated; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON appointment_sales FROM service_role; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT, INSERT ON appointment_sales TO kova_app; END IF;
    END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM appointment_sales)
        THEN RAISE EXCEPTION 'Cannot discard appointment sale attribution'; END IF;
    END $$;""")
    op.drop_table("appointment_sales")

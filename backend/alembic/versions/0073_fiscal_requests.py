"""Internal invoice requests, explicitly pending external provider.

Revision ID: 0073_fiscal_requests
Revises: 0072_branch_transfers
"""

import sqlalchemy as sa

from alembic import op

revision = "0073_fiscal_requests"
down_revision = "0072_branch_transfers"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "fiscal_issuer_profiles",
        sa.Column("tenant_id", sa.Uuid(), primary_key=True),
        sa.Column("fiscal_data", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
    )
    op.create_table(
        "invoice_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_provider"),
        sa.Column("issuer_snapshot", sa.JSON(), nullable=False),
        sa.Column("recipient_snapshot", sa.JSON(), nullable=False),
        sa.Column("pricing_snapshot", sa.JSON(), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "order_id", name="uq_invoice_requests_order"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_invoice_requests_order",
        ),
        sa.CheckConstraint("status = 'pending_provider'", name="ck_invoice_requests_pending"),
        sa.CheckConstraint("total_amount > 0", name="ck_invoice_requests_total"),
    )
    op.create_index("ix_invoice_requests_tenant_id", "invoice_requests", ["tenant_id"])
    op.create_index("ix_invoice_requests_branch_id", "invoice_requests", ["branch_id"])
    for table in ("fiscal_issuer_profiles", "invoice_requests"):
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
            REVOKE ALL ON {table} FROM PUBLIC;
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                    REVOKE ALL ON {table} FROM anon;
                END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                    REVOKE ALL ON {table} FROM authenticated;
                END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                    GRANT SELECT, INSERT ON {table} TO kova_app;
                END IF;
            END $$;
        """)
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT UPDATE (fiscal_data) ON fiscal_issuer_profiles TO kova_app;
        END IF;
    END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM invoice_requests) OR EXISTS (SELECT 1 FROM fiscal_issuer_profiles) THEN
            RAISE EXCEPTION 'Cannot erase fiscal request/profile data; retain migration 0073';
        END IF;
    END $$;""")
    op.drop_table("invoice_requests")
    op.drop_table("fiscal_issuer_profiles")

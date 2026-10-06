"""Durable organization connections and individual CFDI lifecycle journal.

Revision ID: 0074_cfdi_documents
Revises: 0073_fiscal_requests
"""

import sqlalchemy as sa

from alembic import op

revision = "0074_cfdi_documents"
down_revision = "0073_fiscal_requests"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint(
        "uq_invoice_requests_tenant_id_id", "invoice_requests", ["tenant_id", "id"]
    )
    op.create_table(
        "cfdi_connections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("environment", sa.String(8), nullable=False),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=False),
        sa.Column("issuer_rfc", sa.String(13), nullable=True),
        sa.Column("production_ready", sa.Boolean(), nullable=False),
        sa.Column("certificate_expires_at", sa.DateTime(timezone=True)),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.UniqueConstraint("tenant_id", "environment", name="uq_cfdi_connection_environment"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_cfdi_connection_tenant_id"),
        sa.CheckConstraint("environment IN ('test','live')", name="ck_cfdi_connection_environment"),
    )
    op.create_index("ix_cfdi_connections_tenant_id", "cfdi_connections", ["tenant_id"])
    op.create_table(
        "cfdi_documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=False),
        sa.Column("environment", sa.String(8), nullable=False),
        sa.Column("organization_id", sa.String(100), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("external_id", sa.String(200), nullable=False),
        sa.Column("provider_key", sa.String(200), nullable=False),
        sa.Column("provider_id", sa.String(100)),
        sa.Column("uuid", sa.Uuid()),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("xml_bytes", sa.LargeBinary()),
        sa.Column("last_error_code", sa.String(80)),
        sa.Column("cancellation_status", sa.String(40)),
        sa.Column("cancellation_key", sa.String(200)),
        sa.Column("cancellation_hash", sa.String(64)),
        sa.Column("cancellation_payload", sa.JSON()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("canceled_at", sa.DateTime(timezone=True)),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_cfdi_document_order",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "request_id"],
            ["invoice_requests.tenant_id", "invoice_requests.id"],
            name="fk_cfdi_document_request",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "connection_id"],
            ["cfdi_connections.tenant_id", "cfdi_connections.id"],
            name="fk_cfdi_document_connection",
        ),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_cfdi_document_idempotency"),
        sa.UniqueConstraint("external_id", name="uq_cfdi_document_external"),
        sa.UniqueConstraint("provider_key", name="uq_cfdi_document_provider_key"),
        sa.CheckConstraint("environment IN ('test','live')", name="ck_cfdi_document_environment"),
        sa.CheckConstraint(
            "state IN ('prepared','submitting','unknown','pending','issued','cancel_pending','canceled','rejected','integrity_error')",
            name="ck_cfdi_document_state",
        ),
        sa.CheckConstraint("total_amount > 0", name="ck_cfdi_document_total"),
    )
    op.create_index("ix_cfdi_documents_tenant_id", "cfdi_documents", ["tenant_id"])
    op.create_index("ix_cfdi_documents_branch_id", "cfdi_documents", ["branch_id"])
    op.create_index(
        "uq_cfdi_document_active_sale",
        "cfdi_documents",
        ["tenant_id", "order_id", "environment"],
        unique=True,
        postgresql_where=sa.text("state NOT IN ('canceled','rejected')"),
    )
    for table in ("cfdi_connections", "cfdi_documents"):
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
            REVOKE ALL ON {table} FROM PUBLIC;
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app; END IF;
            END $$;
        """)
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT UPDATE (organization_id,encrypted_api_key,issuer_rfc,production_ready,certificate_expires_at,refreshed_at) ON cfdi_connections TO kova_app;
            GRANT UPDATE (state,provider_id,uuid,xml_bytes,last_error_code,cancellation_status,cancellation_key,cancellation_hash,cancellation_payload,confirmed_at,canceled_at,updated_at) ON cfdi_documents TO kova_app;
        END IF;
    END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM cfdi_documents) OR EXISTS (SELECT 1 FROM cfdi_connections) THEN
            RAISE EXCEPTION 'Cannot erase CFDI journal or credentials; retain migration 0074';
        END IF;
    END $$;""")
    op.drop_table("cfdi_documents")
    op.drop_table("cfdi_connections")
    op.drop_constraint("uq_invoice_requests_tenant_id_id", "invoice_requests", type_="unique")

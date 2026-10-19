"""Canonical manual settlement reconciliation, with human matching.

Revision ID: 0083_bank_reconciliation
Revises: 0082_public_catalog
"""

import sqlalchemy as sa

from alembic import op

revision = "0083_bank_reconciliation"
down_revision = "0082_public_catalog"
branch_labels = None
depends_on = None


def _identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
    ]


def upgrade():
    op.create_unique_constraint(
        "uq_payments_tenant_order_id_id", "payments", ["tenant_id", "order_id", "id"]
    )
    op.create_table(
        "reconciliation_import_batches",
        *_identity(),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("parser_version", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "id", name="uq_reconciliation_batches_scope_id"
        ),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "content_sha256", name="uq_reconciliation_batch_content"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id"],
            ["branches.tenant_id", "branches.id"],
            name="fk_reconciliation_batch_branch",
        ),
        sa.CheckConstraint(
            "row_count > 0 AND row_count <= 500", name="ck_reconciliation_batch_count"
        ),
    )
    op.create_table(
        "settlement_entries",
        *_identity(),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("fee_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("net_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("payment_method", sa.String(24), nullable=False),
        sa.Column("external_reference_masked", sa.String(64), nullable=False),
        sa.Column("row_fingerprint", sa.String(64), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_settlement_entries_scope_id"),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "row_fingerprint", name="uq_settlement_entries_row"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "batch_id"],
            [
                "reconciliation_import_batches.tenant_id",
                "reconciliation_import_batches.branch_id",
                "reconciliation_import_batches.id",
            ],
            name="fk_settlement_entry_batch",
        ),
        sa.CheckConstraint(
            "gross_amount > 0 AND fee_amount >= 0 AND net_amount > 0 AND gross_amount - fee_amount = net_amount",
            name="ck_settlement_entry_amounts",
        ),
        sa.CheckConstraint("currency = 'MXN'", name="ck_settlement_entry_currency"),
        sa.CheckConstraint(
            "payment_method IN ('bank_transfer','manual_card')", name="ck_settlement_entry_method"
        ),
    )
    op.create_table(
        "reconciliation_matches",
        *_identity(),
        sa.Column("settlement_entry_id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("matched_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.Column("confirmed_by_user_id", sa.Uuid()),
        sa.Column("reversal_reason", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "settlement_entry_id", "payment_id", name="uq_reconciliation_match_payment"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "settlement_entry_id"],
            [
                "settlement_entries.tenant_id",
                "settlement_entries.branch_id",
                "settlement_entries.id",
            ],
            name="fk_reconciliation_match_entry",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_reconciliation_match_order",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id", "payment_id"],
            ["payments.tenant_id", "payments.order_id", "payments.id"],
            name="fk_reconciliation_match_payment",
        ),
        sa.CheckConstraint("matched_amount > 0", name="ck_reconciliation_match_amount"),
        sa.CheckConstraint(
            "status IN ('suggested','confirmed','rejected','reversed')",
            name="ck_reconciliation_match_status",
        ),
        sa.CheckConstraint("version > 0", name="ck_reconciliation_match_version"),
    )
    for table in ("reconciliation_import_batches", "settlement_entries", "reconciliation_matches"):
        for column in ("tenant_id", "branch_id"):
            op.create_index(f"ix_{table}_{column}", table, [column])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL USING (tenant_id::text = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app; END IF;
        END $$;""")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
        GRANT UPDATE (matched_amount, status, version, reasons, confirmed_by_user_id, reversal_reason, updated_at) ON reconciliation_matches TO kova_app;
    END IF; END $$;""")
    op.create_index("ix_settlement_entries_batch_id", "settlement_entries", ["batch_id"])
    op.create_index(
        "ix_reconciliation_matches_settlement_entry_id",
        "reconciliation_matches",
        ["settlement_entry_id"],
    )
    op.create_index(
        "ix_reconciliation_matches_payment_id", "reconciliation_matches", ["payment_id"]
    )


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM reconciliation_import_batches)
        OR EXISTS (SELECT 1 FROM settlement_entries) OR EXISTS (SELECT 1 FROM reconciliation_matches)
        THEN RAISE EXCEPTION 'Cannot discard settlement reconciliation history'; END IF; END $$;""")
    op.drop_table("reconciliation_matches")
    op.drop_table("settlement_entries")
    op.drop_table("reconciliation_import_batches")
    op.drop_constraint("uq_payments_tenant_order_id_id", "payments", type_="unique")

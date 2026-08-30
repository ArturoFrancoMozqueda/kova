"""accountant close packages, individual invoice ledger, and late adjustments

Revision ID: 0062_accountant_packages
Revises: 0061_ops_founder_mfa
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0062_accountant_packages"
down_revision: str | None = "0061_ops_founder_mfa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_NEW_TABLES = (
    "fiscal_individual_invoice_events",
    "fiscal_global_draft_adjustments",
)


def _enable_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )


def upgrade() -> None:
    op.add_column(
        "order_fiscal_snapshots",
        sa.Column(
            "tax_calculation_status",
            sa.String(length=24),
            nullable=False,
            server_default="not_calculated",
        ),
    )
    op.create_check_constraint(
        "ck_order_fiscal_snapshots_tax_status",
        "order_fiscal_snapshots",
        "tax_calculation_status IN ('not_calculated', 'calculated')",
    )
    op.add_column(
        "order_item_fiscal_snapshots",
        sa.Column(
            "tax_calculation_status",
            sa.String(length=24),
            nullable=False,
            server_default="not_calculated",
        ),
    )
    op.create_check_constraint(
        "ck_order_item_fiscal_snapshots_tax_status",
        "order_item_fiscal_snapshots",
        "tax_calculation_status IN ('not_calculated', 'calculated')",
    )

    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column("business_name_snapshot", sa.String(length=180), nullable=True),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column(
            "package_schema_version",
            sa.String(length=40),
            nullable=False,
            server_default="legacy-v1",
        ),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column(
            "tax_calculation_status",
            sa.String(length=24),
            nullable=False,
            server_default="not_calculated",
        ),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column(
            "adjustment_total_amount",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column(
            "adjusted_net_amount",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column("adjustment_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "fiscal_global_draft_batches",
        sa.Column("data_quality_warnings", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.execute(
        "UPDATE fiscal_global_draft_batches "
        "SET adjusted_net_amount = net_total_amount"
    )
    op.create_check_constraint(
        "ck_fiscal_global_batch_tax_status",
        "fiscal_global_draft_batches",
        "tax_calculation_status IN ('not_calculated', 'calculated')",
    )
    op.create_check_constraint(
        "ck_fiscal_global_adjustment_count",
        "fiscal_global_draft_batches",
        "adjustment_count >= 0",
    )

    op.create_table(
        "fiscal_individual_invoice_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("external_reference", sa.String(length=100), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('confirmed', 'reopened')",
            name="ck_fiscal_individual_invoice_event_status",
        ),
        sa.CheckConstraint(
            "(status = 'confirmed' AND external_reference IS NOT NULL AND issued_at IS NOT NULL) "
            "OR (status = 'reopened' AND external_reference IS NULL AND issued_at IS NULL)",
            name="ck_fiscal_individual_invoice_event_fields",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"],
            ["orders.tenant_id", "orders.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_fiscal_individual_events_tenant_order_created",
        "fiscal_individual_invoice_events",
        ["tenant_id", "order_id", "created_at"],
    )

    op.create_table(
        "fiscal_global_draft_adjustments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("original_batch_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("source_refund_id", sa.Uuid(), nullable=True),
        sa.Column("source_event_id", sa.Uuid(), nullable=True),
        sa.Column("adjustment_type", sa.String(length=24), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_fiscal_adjustment_amount"),
        sa.CheckConstraint(
            "adjustment_type IN ('late_refund', 'late_inclusion', 'late_exclusion')",
            name="ck_fiscal_adjustment_type",
        ),
        sa.CheckConstraint(
            "(adjustment_type = 'late_refund' AND source_refund_id IS NOT NULL "
            "AND source_event_id IS NULL) OR "
            "(adjustment_type IN ('late_inclusion', 'late_exclusion') "
            "AND source_refund_id IS NULL AND source_event_id IS NOT NULL)",
            name="ck_fiscal_adjustment_source",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "batch_id"],
            ["fiscal_global_draft_batches.tenant_id", "fiscal_global_draft_batches.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "original_batch_id"],
            ["fiscal_global_draft_batches.tenant_id", "fiscal_global_draft_batches.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"],
            ["orders.tenant_id", "orders.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["source_refund_id"], ["refunds.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["source_event_id"], ["fiscal_individual_invoice_events.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "source_refund_id", name="uq_fiscal_adjustment_tenant_refund"
        ),
        sa.UniqueConstraint(
            "tenant_id", "source_event_id", name="uq_fiscal_adjustment_tenant_event"
        ),
    )
    op.create_index(
        "ix_fiscal_adjustments_tenant_batch",
        "fiscal_global_draft_adjustments",
        ["tenant_id", "batch_id"],
    )
    op.create_index(
        "ix_fiscal_adjustments_tenant_original_batch",
        "fiscal_global_draft_adjustments",
        ["tenant_id", "original_batch_id"],
    )

    for table in _NEW_TABLES:
        _enable_rls(table)
        op.execute(
            f"CREATE TRIGGER trg_{table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION reject_fiscal_history_mutation()"
        )

    op.execute(
        """
        DO $$
        DECLARE role_name text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format(
                'REVOKE ALL ON TABLE fiscal_individual_invoice_events, '
                'fiscal_global_draft_adjustments FROM %I', role_name
              );
            END IF;
          END LOOP;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT SELECT, INSERT ON fiscal_individual_invoice_events,
              fiscal_global_draft_adjustments TO kova_app;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    for table in reversed(_NEW_TABLES):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_immutable ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)

    for name in (
        "ck_fiscal_global_adjustment_count",
        "ck_fiscal_global_batch_tax_status",
    ):
        op.drop_constraint(name, "fiscal_global_draft_batches", type_="check")
    for column in (
        "data_quality_warnings",
        "adjustment_count",
        "adjusted_net_amount",
        "adjustment_total_amount",
        "tax_calculation_status",
        "package_schema_version",
        "business_name_snapshot",
    ):
        op.drop_column("fiscal_global_draft_batches", column)

    op.drop_constraint(
        "ck_order_item_fiscal_snapshots_tax_status",
        "order_item_fiscal_snapshots",
        type_="check",
    )
    op.drop_column("order_item_fiscal_snapshots", "tax_calculation_status")
    op.drop_constraint(
        "ck_order_fiscal_snapshots_tax_status", "order_fiscal_snapshots", type_="check"
    )
    op.drop_column("order_fiscal_snapshots", "tax_calculation_status")

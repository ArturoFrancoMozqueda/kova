"""add immutable sale fiscal snapshots and operational global drafts

Revision ID: 0058_fiscal_snapshots
Revises: 0057_receipt_paper_width
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0058_fiscal_snapshots"
down_revision: str | None = "0057_receipt_paper_width"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TENANT_QUAL = "tenant_id::text = current_setting('app.tenant_id', true)"
_IMMUTABLE_TABLES = (
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
)
_TENANT_TABLES = (
    "order_fiscal_snapshots",
    "order_item_fiscal_snapshots",
    "order_item_tax_snapshots",
    "fiscal_global_draft_settings",
    "fiscal_global_draft_batches",
    "fiscal_global_draft_orders",
)
_PERMISSIONS = ("fiscal.view", "fiscal.manage")


def _enable_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING ({_TENANT_QUAL}) WITH CHECK ({_TENANT_QUAL})"
    )


def _explicit_grants() -> None:
    # Supabase's 2026 Data API default no longer grants new public tables.
    # These are backend-only financial tables: never expose them to anon/authenticated.
    op.execute(
        """
        DO $$
        DECLARE role_name text;
        BEGIN
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
              EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',
                'order_fiscal_snapshots, order_item_fiscal_snapshots, '
                'order_item_tax_snapshots, fiscal_global_draft_settings, '
                'fiscal_global_draft_batches, fiscal_global_draft_orders', role_name);
            END IF;
          END LOOP;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT SELECT, INSERT ON order_fiscal_snapshots,
              order_item_fiscal_snapshots, order_item_tax_snapshots,
              fiscal_global_draft_batches, fiscal_global_draft_orders TO kova_app;
            GRANT SELECT, INSERT, UPDATE ON fiscal_global_draft_settings TO kova_app;
          END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.create_unique_constraint("uq_orders_tenant_id_id", "orders", ["tenant_id", "id"])

    op.create_table(
        "order_fiscal_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("gross_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("discount_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tax_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("pricing_engine_version", sa.String(40), nullable=False),
        sa.Column("tax_catalog_version", sa.String(80), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("individual_fiscal_status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("gross_amount >= 0", name="ck_order_fiscal_snapshots_gross"),
        sa.CheckConstraint("discount_total_amount >= 0", name="ck_order_fiscal_snapshots_discount"),
        sa.CheckConstraint("tax_total_amount >= 0", name="ck_order_fiscal_snapshots_tax"),
        sa.CheckConstraint("total_amount >= 0", name="ck_order_fiscal_snapshots_total"),
        sa.CheckConstraint(
            "gross_amount - discount_total_amount + tax_total_amount = total_amount",
            name="ck_order_fiscal_snapshots_equation",
        ),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_order_fiscal_snapshots_currency"),
        sa.CheckConstraint(
            "individual_fiscal_status IN ('none', 'confirmed')",
            name="ck_order_fiscal_snapshots_individual_status",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"],
            ["orders.tenant_id", "orders.id"],
            ondelete="CASCADE",
            name="fk_order_fiscal_snapshots_tenant_order",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "order_id", name="uq_order_fiscal_snapshots_tenant_order"),
    )
    op.create_index("ix_order_fiscal_snapshots_tenant_id", "order_fiscal_snapshots", ["tenant_id"])
    op.create_index("ix_order_fiscal_snapshots_order_id", "order_fiscal_snapshots", ["order_id"])
    op.create_index(
        "ix_order_fiscal_snapshots_tenant_individual_status",
        "order_fiscal_snapshots",
        ["tenant_id", "individual_fiscal_status"],
    )

    op.create_table(
        "order_item_fiscal_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("product_name", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("gross_line_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("line_discount_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("order_discount_allocated_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("net_before_tax_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tax_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("line_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tax_object_code_snapshot", sa.String(8), nullable=True),
        sa.Column("product_service_code_snapshot", sa.String(16), nullable=True),
        sa.Column("unit_code_snapshot", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_order_item_fiscal_snapshots_quantity"),
        sa.CheckConstraint(
            "gross_line_amount >= 0 AND line_discount_amount >= 0 "
            "AND order_discount_allocated_amount >= 0 AND net_before_tax_amount >= 0 "
            "AND tax_total_amount >= 0 AND line_total_amount >= 0",
            name="ck_order_item_fiscal_snapshots_amounts",
        ),
        sa.CheckConstraint(
            "gross_line_amount - line_discount_amount - order_discount_allocated_amount "
            "= net_before_tax_amount",
            name="ck_order_item_fiscal_snapshots_net_equation",
        ),
        sa.CheckConstraint(
            "net_before_tax_amount + tax_total_amount = line_total_amount",
            name="ck_order_item_fiscal_snapshots_total_equation",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"], ["orders.tenant_id", "orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_item_id"],
            ["order_items.tenant_id", "order_items.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "order_item_id", name="uq_order_item_fiscal_snapshots_tenant_item"
        ),
    )
    op.create_index(
        "ix_order_item_fiscal_snapshots_tenant_id", "order_item_fiscal_snapshots", ["tenant_id"]
    )
    op.create_index(
        "ix_order_item_fiscal_snapshots_order_id", "order_item_fiscal_snapshots", ["order_id"]
    )
    op.create_index(
        "ix_order_item_fiscal_snapshots_order_item_id",
        "order_item_fiscal_snapshots",
        ["order_item_id"],
    )

    op.create_table(
        "order_item_tax_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("tax_code", sa.String(16), nullable=False),
        sa.Column("factor_type", sa.String(16), nullable=False),
        sa.Column("base_amount", sa.Numeric(18, 6), nullable=False),
        sa.Column("rate_or_quota", sa.Numeric(18, 6), nullable=True),
        sa.Column("tax_amount", sa.Numeric(18, 6), nullable=True),
        sa.Column("catalog_version", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "direction IN ('transfer', 'withholding')", name="ck_tax_snapshots_direction"
        ),
        sa.CheckConstraint(
            "factor_type IN ('rate', 'quota', 'exempt')", name="ck_tax_snapshots_factor"
        ),
        sa.CheckConstraint("base_amount >= 0", name="ck_tax_snapshots_base"),
        sa.CheckConstraint(
            "rate_or_quota IS NULL OR rate_or_quota >= 0", name="ck_tax_snapshots_rate"
        ),
        sa.CheckConstraint("tax_amount IS NULL OR tax_amount >= 0", name="ck_tax_snapshots_amount"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"], ["orders.tenant_id", "orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_item_id"],
            ["order_item_fiscal_snapshots.tenant_id", "order_item_fiscal_snapshots.order_item_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_order_item_tax_snapshots_tenant_id", "order_item_tax_snapshots", ["tenant_id"]
    )
    op.create_index(
        "ix_order_item_tax_snapshots_order_id", "order_item_tax_snapshots", ["order_id"]
    )
    op.create_index(
        "ix_order_item_tax_snapshots_order_item_id", "order_item_tax_snapshots", ["order_item_id"]
    )

    op.create_table(
        "fiscal_global_draft_settings",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("weekly_close_day", sa.Integer(), nullable=False),
        sa.Column("monthly_close_day", sa.Integer(), nullable=False),
        sa.Column("auto_close_enabled", sa.Boolean(), nullable=False),
        sa.Column("auto_processed_through", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "frequency IN ('daily', 'weekly', 'monthly')", name="ck_fiscal_draft_frequency"
        ),
        sa.CheckConstraint(
            "weekly_close_day BETWEEN 1 AND 7", name="ck_fiscal_draft_weekly_close_day"
        ),
        sa.CheckConstraint(
            "monthly_close_day BETWEEN 1 AND 31", name="ck_fiscal_draft_monthly_close_day"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("tenant_id"),
    )

    op.create_table(
        "fiscal_global_draft_batches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("document_kind", sa.String(32), nullable=False),
        sa.Column("fiscal_status", sa.String(16), nullable=False),
        sa.Column("gross_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("discount_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tax_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("refund_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("net_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("order_count", sa.Integer(), nullable=False),
        sa.Column("excluded_individually_confirmed_count", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'closed')", name="ck_fiscal_global_draft_status"),
        sa.CheckConstraint(
            "document_kind = 'operational_draft'", name="ck_fiscal_global_document_kind"
        ),
        sa.CheckConstraint("fiscal_status = 'not_issued'", name="ck_fiscal_global_fiscal_status"),
        sa.CheckConstraint("period_start <= period_end", name="ck_fiscal_global_period"),
        sa.CheckConstraint("order_count >= 0", name="ck_fiscal_global_order_count"),
        sa.CheckConstraint(
            "excluded_individually_confirmed_count >= 0",
            name="ck_fiscal_global_excluded_count",
        ),
        sa.CheckConstraint(
            "refund_total_amount >= 0 AND net_total_amount >= 0 "
            "AND total_amount - refund_total_amount = net_total_amount",
            name="ck_fiscal_global_refund_net",
        ),
        sa.CheckConstraint(
            "gross_amount - discount_total_amount + tax_total_amount = total_amount",
            name="ck_fiscal_global_amount_equation",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "period_start", "period_end", name="uq_fiscal_global_tenant_period"
        ),
        sa.UniqueConstraint("tenant_id", "id", name="uq_fiscal_global_batches_tenant_id_id"),
    )
    op.create_index(
        "ix_fiscal_global_draft_batches_tenant_id", "fiscal_global_draft_batches", ["tenant_id"]
    )
    op.create_index(
        "ix_fiscal_global_draft_batches_tenant_period",
        "fiscal_global_draft_batches",
        ["tenant_id", "period_end"],
    )

    op.create_table(
        "fiscal_global_draft_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("refund_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("net_total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "refund_total_amount >= 0 AND net_total_amount >= 0",
            name="ck_fiscal_global_draft_orders_refund_net",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "batch_id"],
            ["fiscal_global_draft_batches.tenant_id", "fiscal_global_draft_batches.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "order_id"], ["orders.tenant_id", "orders.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id", "order_id", name="uq_fiscal_global_draft_orders_tenant_order"
        ),
    )
    op.create_index(
        "ix_fiscal_global_draft_orders_tenant_id", "fiscal_global_draft_orders", ["tenant_id"]
    )
    op.create_index(
        "ix_fiscal_global_draft_orders_batch_id", "fiscal_global_draft_orders", ["batch_id"]
    )
    op.create_index(
        "ix_fiscal_global_draft_orders_order_id", "fiscal_global_draft_orders", ["order_id"]
    )

    # Expand/backfill: freeze every historical sale exactly as stored. Legacy
    # rows carry a distinct engine version and no inferred tax metadata.
    op.execute(
        """
        INSERT INTO order_fiscal_snapshots
          (id, tenant_id, order_id, gross_amount, discount_total_amount,
           tax_total_amount, total_amount, pricing_engine_version,
           tax_catalog_version, currency, individual_fiscal_status, created_at)
        SELECT gen_random_uuid(), tenant_id, id, subtotal_amount, 0, 0,
               total_amount, 'legacy-baseline-v1', NULL, 'MXN', 'none', created_at
        FROM orders
        """
    )
    op.execute(
        """
        INSERT INTO order_item_fiscal_snapshots
          (id, tenant_id, order_id, order_item_id, product_id, product_name,
           quantity, unit_price_amount, gross_line_amount, line_discount_amount,
           order_discount_allocated_amount, net_before_tax_amount,
           tax_total_amount, line_total_amount, tax_object_code_snapshot,
           product_service_code_snapshot, unit_code_snapshot, created_at)
        SELECT gen_random_uuid(), tenant_id, order_id, id, product_id, product_name,
               quantity, unit_price_amount, line_total_amount, 0, 0,
               line_total_amount, 0, line_total_amount, NULL, NULL, NULL, now()
        FROM order_items
        """
    )

    op.execute(
        """
        CREATE FUNCTION reject_fiscal_history_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
          IF TG_OP = 'DELETE'
             AND current_setting('app.allow_fiscal_history_delete', true) = 'on' THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION '% is immutable; use an audited compensating workflow', TG_TABLE_NAME
            USING ERRCODE = '55000';
        END;
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION reject_fiscal_history_mutation() FROM PUBLIC")
    for table in _IMMUTABLE_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION reject_fiscal_history_mutation()"
        )

    for table in _TENANT_TABLES:
        _enable_rls(table)
    _explicit_grants()

    for permission in _PERMISSIONS:
        op.execute(
            sa.text("INSERT INTO permissions (name) VALUES (:name)").bindparams(name=permission)
        )
    for role, permission in (
        ("owner", "fiscal.view"),
        ("owner", "fiscal.manage"),
        ("manager", "fiscal.view"),
    ):
        op.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT r.id, p.id FROM roles r, permissions p "
                "WHERE r.name = :role AND p.name = :permission"
            ).bindparams(role=role, permission=permission)
        )


def downgrade() -> None:
    for permission in _PERMISSIONS:
        op.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE name = :name)"
            ).bindparams(name=permission)
        )
        op.execute(
            sa.text("DELETE FROM permissions WHERE name = :name").bindparams(name=permission)
        )

    for table in _IMMUTABLE_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_immutable ON {table}")
    op.execute("DROP FUNCTION IF EXISTS reject_fiscal_history_mutation()")
    for table in reversed(_TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
    op.drop_constraint("uq_orders_tenant_id_id", "orders", type_="unique")

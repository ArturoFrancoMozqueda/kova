"""Immutable customer quote snapshots and atomic links to unpaid orders."""

import sqlalchemy as sa

from alembic import op

revision = "0084_customer_quotes"
down_revision = "0083_bank_reconciliation"
branch_labels = None
depends_on = None


def _identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
    ]


def upgrade():
    op.create_table(
        "customer_quotes",
        *_identity(),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("folio", sa.String(12), nullable=False),
        sa.Column("customer_name", sa.String(160), nullable=False),
        sa.Column("customer_phone", sa.String(30)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("shared_at", sa.DateTime(timezone=True)),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("customer_order_id", sa.Uuid()),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_customer_quote_owner"),
        sa.UniqueConstraint("tenant_id", "folio", name="uq_customer_quote_folio"),
        sa.UniqueConstraint("customer_order_id", name="uq_customer_quote_order"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "updated_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint("version >= 1 AND total_amount >= 0", name="ck_customer_quote_amount"),
        sa.CheckConstraint(
            "status IN ('draft','sent','accepted','expired','cancelled')",
            name="ck_customer_quote_status",
        ),
        sa.CheckConstraint(
            "(status = 'accepted') = (customer_order_id IS NOT NULL)",
            name="ck_customer_quote_accepted_order",
        ),
    )
    op.create_table(
        "customer_quote_items",
        *_identity(),
        sa.Column("quote_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("product_name", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total_amount", sa.Numeric(12, 2), nullable=False),
        sa.UniqueConstraint("quote_id", "product_id", name="uq_customer_quote_item_product"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "quote_id"],
            ["customer_quotes.tenant_id", "customer_quotes.branch_id", "customer_quotes.id"],
        ),
        sa.ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
        sa.CheckConstraint(
            "quantity > 0 AND quantity <= 100000 AND unit_price_amount >= 0 "
            "AND line_total_amount = unit_price_amount * quantity",
            name="ck_customer_quote_item_amount",
        ),
    )
    for table in ("customer_quotes", "customer_quote_items"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table} FOR ALL
              USING (tenant_id::text = current_setting('app.tenant_id', true))
              WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
            REVOKE ALL ON {table} FROM PUBLIC;
            DO $$ DECLARE r text; BEGIN
              FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
                  EXECUTE format('REVOKE ALL ON {table} FROM %I', r);
                END IF;
              END LOOP;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
                GRANT SELECT, INSERT ON {table} TO kova_app;
              END IF;
            END $$;
        """)
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT UPDATE (status, shared_at, accepted_at, customer_order_id,
              updated_by_user_id, version, updated_at) ON customer_quotes TO kova_app;
        END IF;
    END $$;""")
    op.create_index("ix_customer_quotes_customer_id", "customer_quotes", ["customer_id"])
    op.create_index("ix_customer_quote_items_quote_id", "customer_quote_items", ["quote_id"])


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM customer_quotes) OR EXISTS (SELECT 1 FROM customer_quote_items) THEN
            RAISE EXCEPTION 'Preserve quote history before downgrade';
        END IF;
    END $$""")
    op.drop_table("customer_quote_items")
    op.drop_table("customer_quotes")

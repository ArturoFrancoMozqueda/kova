"""Tenant-owned customers and product barcodes.

Revision ID: 0070_customers_barcodes
Revises: 0069_sales_pricing
"""

import sqlalchemy as sa

from alembic import op

revision = "0070_customers_barcodes"
down_revision = "0069_sales_pricing"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(254)),
        sa.Column("phone", sa.String(30)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "id", name="uq_customers_tenant_id_id"),
    )
    op.create_index("ix_customers_tenant_id", "customers", ["tenant_id"])
    op.add_column("products", sa.Column("barcode", sa.String(100)))
    op.create_unique_constraint("uq_products_tenant_barcode", "products", ["tenant_id", "barcode"])
    op.add_column("orders", sa.Column("customer_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_orders_tenant_customer",
        "orders",
        "customers",
        ["tenant_id", "customer_id"],
        ["tenant_id", "id"],
    )
    op.create_index("ix_orders_tenant_customer", "orders", ["tenant_id", "customer_id"])
    op.execute("""
        ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
        ALTER TABLE customers FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON customers FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        REVOKE ALL ON customers FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON customers FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON customers FROM authenticated;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT SELECT, INSERT, UPDATE ON customers TO kova_app;
            END IF;
        END $$;
    """)


def downgrade():
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM customers)
                OR EXISTS (SELECT 1 FROM products WHERE barcode IS NOT NULL)
                OR EXISTS (SELECT 1 FROM orders WHERE customer_id IS NOT NULL) THEN
                RAISE EXCEPTION 'Cannot discard customer or barcode data; retain migration 0070';
            END IF;
        END $$;
    """)
    op.drop_index("ix_orders_tenant_customer", table_name="orders")
    op.drop_constraint("fk_orders_tenant_customer", "orders", type_="foreignkey")
    op.drop_column("orders", "customer_id")
    op.drop_constraint("uq_products_tenant_barcode", "products", type_="unique")
    op.drop_column("products", "barcode")
    op.drop_table("customers")

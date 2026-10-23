"""Explicit customer identity for direct orders, without inferring old contacts."""

import sqlalchemy as sa

from alembic import op

revision = "0095_customer_order_customer"
down_revision = "0094_appointment_sales"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("customer_orders", sa.Column("customer_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_customer_orders_customer", "customer_orders", "customers",
        ["tenant_id", "customer_id"], ["tenant_id", "id"],
    )
    op.create_index(
        "ix_customer_orders_customer", "customer_orders", ["tenant_id", "branch_id", "customer_id"]
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM customer_orders WHERE customer_id IS NOT NULL)
        THEN RAISE EXCEPTION 'Cannot discard explicit order customer attribution'; END IF;
    END $$;""")
    op.drop_index("ix_customer_orders_customer", table_name="customer_orders")
    op.drop_constraint("fk_customer_orders_customer", "customer_orders", type_="foreignkey")
    op.drop_column("customer_orders", "customer_id")

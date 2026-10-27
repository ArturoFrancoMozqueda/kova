"""Structured menu requests and explicit, branch-owned operational order attribution."""

import sqlalchemy as sa

from alembic import op

revision = "0096_catalog_order_intake"
down_revision = "0095_customer_order_customer"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("crm_catalog_requests", sa.Column("order_lines", sa.JSON(), nullable=True))
    op.add_column("crm_catalog_requests", sa.Column("origin", sa.String(16), nullable=True))
    op.add_column("crm_catalog_requests", sa.Column("customer_order_id", sa.Uuid(), nullable=True))
    op.drop_constraint("ck_catalog_request_status", "crm_catalog_requests", type_="check")
    op.create_check_constraint(
        "ck_catalog_request_status", "crm_catalog_requests",
        "status IN ('new','converted','dismissed','accepted')",
    )
    op.create_check_constraint(
        "ck_catalog_request_structure", "crm_catalog_requests",
        "(order_lines IS NULL AND origin IS NULL) OR "
        "(order_lines IS NOT NULL AND origin IS NOT NULL AND origin IN ('remote','in_store') "
        "AND json_typeof(order_lines) = 'array' AND json_array_length(order_lines) BETWEEN 1 AND 20)",
    )
    op.create_check_constraint(
        "ck_catalog_request_order_link", "crm_catalog_requests",
        "(status = 'accepted' AND customer_order_id IS NOT NULL AND customer_id IS NOT NULL "
        "AND order_lines IS NOT NULL) OR (status <> 'accepted' AND customer_order_id IS NULL)",
    )
    op.create_foreign_key(
        "fk_catalog_request_order", "crm_catalog_requests", "customer_orders",
        ["tenant_id", "branch_id", "customer_order_id"], ["tenant_id", "branch_id", "id"],
    )
    op.create_unique_constraint(
        "uq_catalog_request_order", "crm_catalog_requests",
        ["tenant_id", "branch_id", "customer_order_id"],
    )
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT UPDATE (customer_order_id) ON crm_catalog_requests TO kova_app;
        END IF;
    END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM crm_catalog_requests WHERE order_lines IS NOT NULL
                   OR origin IS NOT NULL OR customer_order_id IS NOT NULL OR status='accepted')
        THEN RAISE EXCEPTION 'Cannot discard structured menu requests or order attribution';
        END IF;
    END $$;""")
    op.drop_constraint("uq_catalog_request_order", "crm_catalog_requests", type_="unique")
    op.drop_constraint("fk_catalog_request_order", "crm_catalog_requests", type_="foreignkey")
    op.drop_constraint("ck_catalog_request_order_link", "crm_catalog_requests", type_="check")
    op.drop_constraint("ck_catalog_request_structure", "crm_catalog_requests", type_="check")
    op.drop_constraint("ck_catalog_request_status", "crm_catalog_requests", type_="check")
    op.create_check_constraint(
        "ck_catalog_request_status", "crm_catalog_requests",
        "status IN ('new','converted','dismissed')",
    )
    op.drop_column("crm_catalog_requests", "customer_order_id")
    op.drop_column("crm_catalog_requests", "origin")
    op.drop_column("crm_catalog_requests", "order_lines")

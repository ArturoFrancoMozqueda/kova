"""Receive purchases with differences and find sales by receipt folio.

A purchase line may now receive more than ordered or be closed with units
still missing; both need a written reason that stays on the line as evidence
(`difference_reason`), and `closed_at` marks a line that will not receive the
rest. The quantity check keeps `received_quantity >= 0` and moves the upper
bound into a rule that requires that reason.

Sales get an expression index on the receipt folio (last eight hex characters
of the id) so `GET /orders?q=` finds a ticket without scanning the tenant.

Additive for the previous app version: it never writes the new columns, keeps
receiving within the ordered quantity and ignores the index. Downgrade is
refused once a line carries a recorded difference.
"""

import sqlalchemy as sa

from alembic import op

revision = "0113_receiving_differences"
down_revision = "0112_batch_production"
branch_labels = None
depends_on = None

# Must match app.orders.repository.receipt_folio_expression exactly.
FOLIO_EXPRESSION = "right(replace(CAST(id AS VARCHAR), '-', ''), 8)"


def upgrade():
    op.add_column(
        "purchase_order_items",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "purchase_order_items",
        sa.Column("difference_reason", sa.String(200), nullable=True),
    )
    op.drop_constraint("ck_purchase_items_quantity", "purchase_order_items", type_="check")
    op.create_check_constraint(
        "ck_purchase_items_quantity",
        "purchase_order_items",
        "quantity > 0 AND received_quantity >= 0",
    )
    op.create_check_constraint(
        "ck_purchase_items_difference",
        "purchase_order_items",
        "(received_quantity <= quantity AND closed_at IS NULL) "
        "OR coalesce(length(btrim(difference_reason)), 0) > 0",
    )
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
        GRANT UPDATE (received_quantity, closed_at, difference_reason)
            ON purchase_order_items TO kova_app;
    END IF; END $$;""")
    op.execute(f"CREATE INDEX ix_orders_tenant_folio ON orders (tenant_id, ({FOLIO_EXPRESSION}))")


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM purchase_order_items "
        "WHERE received_quantity > quantity OR closed_at IS NOT NULL "
        "OR difference_reason IS NOT NULL) "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded receiving differences'; "
        "END IF; END $$;"
    )
    op.drop_index("ix_orders_tenant_folio", table_name="orders")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
        REVOKE UPDATE (closed_at, difference_reason) ON purchase_order_items FROM kova_app;
    END IF; END $$;""")
    op.drop_constraint("ck_purchase_items_difference", "purchase_order_items", type_="check")
    op.drop_constraint("ck_purchase_items_quantity", "purchase_order_items", type_="check")
    op.create_check_constraint(
        "ck_purchase_items_quantity",
        "purchase_order_items",
        "quantity > 0 AND received_quantity >= 0 AND received_quantity <= quantity",
    )
    op.drop_column("purchase_order_items", "difference_reason")
    op.drop_column("purchase_order_items", "closed_at")

"""Atomic inventory transfers and optional employee branch assignment."""

import sqlalchemy as sa

from alembic import op

revision = "0072_branch_transfers"
down_revision = "0071_purchasing"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("memberships", sa.Column("allowed_branch_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_memberships_allowed_branch",
        "memberships",
        "branches",
        ["tenant_id", "allowed_branch_id"],
        ["tenant_id", "id"],
    )
    op.create_table(
        "inventory_transfers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("source_branch_id", sa.Uuid(), nullable=False),
        sa.Column("destination_branch_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("product_name", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "source_branch_id"], ["branches.tenant_id", "branches.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "destination_branch_id"], ["branches.tenant_id", "branches.id"]
        ),
        sa.ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
        sa.CheckConstraint("quantity > 0", name="ck_transfers_quantity"),
        sa.CheckConstraint(
            "source_branch_id <> destination_branch_id", name="ck_transfers_distinct_branches"
        ),
    )
    op.create_index("ix_inventory_transfers_tenant_id", "inventory_transfers", ["tenant_id"])
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale','adjustment','stock_take','purchase','transfer_in','transfer_out')",
    )
    op.execute("""
        ALTER TABLE inventory_transfers ENABLE ROW LEVEL SECURITY;
        ALTER TABLE inventory_transfers FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON inventory_transfers FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        REVOKE ALL ON inventory_transfers FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON inventory_transfers FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON inventory_transfers FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT SELECT, INSERT ON inventory_transfers TO kova_app;
                GRANT UPDATE (allowed_branch_id) ON memberships TO kova_app;
            END IF;
        END $$;
    """)


def downgrade():
    # Keep recorded inventory history; refuse downgrade after the feature is used.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM inventory_transfers) THEN RAISE EXCEPTION 'Cannot downgrade recorded inventory transfers'; END IF; END $$;"
    )
    op.drop_table("inventory_transfers")
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale','adjustment','stock_take','purchase')",
    )
    op.drop_constraint("fk_memberships_allowed_branch", "memberships", type_="foreignkey")
    op.drop_column("memberships", "allowed_branch_id")

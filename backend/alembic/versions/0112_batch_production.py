"""Batch production: recipes with an expected yield and recorded batches.

A batch consumes ingredients once (`consumption` movements linked to the
batch) and adds the finished pieces actually obtained (`production`). Selling
those pieces moves only the finished product, so ingredients are never
discounted twice. Additive: an older app version ignores batches; downgrade
is refused once production history exists.
"""

import sqlalchemy as sa

from alembic import op

revision = "0112_batch_production"
down_revision = "0111_recipes_on_sale"
branch_labels = None
depends_on = None

_TYPES = "'sale','adjustment','stock_take','purchase','transfer_in','transfer_out','consumption'"


def upgrade():
    op.add_column("recipes", sa.Column("batch_yield", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_recipes_batch_yield",
        "recipes",
        "(mode = 'on_sale' AND batch_yield IS NULL) OR "
        "(mode = 'batch' AND batch_yield IS NOT NULL AND batch_yield > 0)",
    )
    op.create_table(
        "production_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("product_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("recipe_id", sa.Uuid(), nullable=False),
        sa.Column("batches", sa.Integer(), nullable=False),
        sa.Column("expected_quantity", sa.Integer(), nullable=False),
        sa.Column("actual_quantity", sa.Integer(), nullable=False),
        sa.Column("waste_reason_code", sa.String(30), nullable=True),
        sa.Column("ingredient_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("catalog_cost_updated", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("notes", sa.String(255), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"],
                                name="fk_production_batches_branch"),
        sa.ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"],
                                name="fk_production_batches_product"),
        sa.ForeignKeyConstraint(["tenant_id", "recipe_id"], ["recipes.tenant_id", "recipes.id"],
                                name="fk_production_batches_recipe"),
        sa.UniqueConstraint("tenant_id", "branch_id", "id",
                            name="uq_production_batches_tenant_branch_id"),
        sa.CheckConstraint("batches > 0", name="ck_production_batches_batches"),
        sa.CheckConstraint("expected_quantity > 0", name="ck_production_batches_expected"),
        sa.CheckConstraint("actual_quantity >= 0", name="ck_production_batches_actual"),
        sa.CheckConstraint(
            "waste_reason_code IS NULL OR waste_reason_code IN "
            "('merma', 'caducidad', 'robo', 'daño', 'autoconsumo', 'otro')",
            name="ck_production_batches_reason",
        ),
        sa.CheckConstraint("ingredient_cost IS NULL OR ingredient_cost >= 0",
                           name="ck_production_batches_cost"),
    )
    op.execute("ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE production_batches FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation ON production_batches FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute("REVOKE ALL ON production_batches FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON production_batches FROM {role};
            END IF;
        END $$""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT SELECT, INSERT ON production_batches TO kova_app;
        END IF;
    END $$""")

    op.add_column("inventory_movements",
                  sa.Column("production_batch_id", sa.Uuid(), nullable=True))
    op.create_index("ix_inventory_movements_production_batch", "inventory_movements",
                    ["production_batch_id"],
                    postgresql_where=sa.text("production_batch_id IS NOT NULL"))
    op.create_foreign_key(
        "fk_inventory_movements_production_batch", "inventory_movements", "production_batches",
        ["tenant_id", "branch_id", "production_batch_id"], ["tenant_id", "branch_id", "id"],
    )
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint("ck_inventory_movements_type", "inventory_movements",
                               f"movement_type IN ({_TYPES},'production')")


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM production_batches) "
        "OR EXISTS (SELECT 1 FROM recipes WHERE mode = 'batch') "
        "OR EXISTS (SELECT 1 FROM inventory_movements WHERE movement_type = 'production') "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded production history'; "
        "END IF; END $$;"
    )
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint("ck_inventory_movements_type", "inventory_movements",
                               f"movement_type IN ({_TYPES})")
    op.drop_constraint("fk_inventory_movements_production_batch", "inventory_movements",
                       type_="foreignkey")
    op.drop_index("ix_inventory_movements_production_batch", table_name="inventory_movements")
    op.drop_column("inventory_movements", "production_batch_id")
    op.drop_table("production_batches")
    op.drop_constraint("ck_recipes_batch_yield", "recipes", type_="check")
    op.drop_column("recipes", "batch_yield")

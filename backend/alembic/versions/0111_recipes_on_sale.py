"""Versioned recipes consumed at sale and per-option ingredient adjustments.

Additive: three tenant tables with composite tenant FKs, forced RLS and
least-privilege grants. Recipe versions and their lines are append-only for
the runtime role; option adjustments are replaced as a set. Inventory gains
the `consumption` movement type. An older app version ignores these tables,
so a release rollback keeps selling without consuming ingredients. Downgrade
is refused once recipes or consumption history exist.
"""

import sqlalchemy as sa

from alembic import op

revision = "0111_recipes_on_sale"
down_revision = "0110_ingredients_units"
branch_labels = None
depends_on = None

_GRANTS = {
    "recipes": "SELECT, INSERT",
    "recipe_lines": "SELECT, INSERT",
    "modifier_option_consumptions": "SELECT, INSERT, DELETE",
}


def _secure(table: str, grants: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON {table} FROM {role};
            END IF;
        END $$""")
    op.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT {grants} ON {table} TO kova_app;
        END IF;
    END $$""")


def upgrade():
    op.create_table(
        "recipes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("product_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False, server_default="on_sale"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id", "product_id"], ["products.tenant_id", "products.id"],
            name="fk_recipes_tenant_product",
        ),
        sa.UniqueConstraint("tenant_id", "id", name="uq_recipes_tenant_id_id"),
        sa.UniqueConstraint(
            "tenant_id", "product_id", "version", name="uq_recipes_product_version"
        ),
        sa.CheckConstraint("version > 0", name="ck_recipes_version"),
        sa.CheckConstraint("mode IN ('on_sale', 'batch')", name="ck_recipes_mode"),
    )
    op.create_index(
        "ix_recipes_product_effective", "recipes", ["tenant_id", "product_id", "effective_from"]
    )
    op.create_table(
        "recipe_lines",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("recipe_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("ingredient_product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "recipe_id"], ["recipes.tenant_id", "recipes.id"],
            name="fk_recipe_lines_tenant_recipe",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ingredient_product_id"], ["products.tenant_id", "products.id"],
            name="fk_recipe_lines_tenant_ingredient",
        ),
        sa.UniqueConstraint(
            "recipe_id", "ingredient_product_id", name="uq_recipe_lines_ingredient"
        ),
        sa.CheckConstraint("quantity > 0", name="ck_recipe_lines_quantity"),
    )
    op.create_table(
        "modifier_option_consumptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("modifier_option_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("ingredient_product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["tenant_id", "modifier_option_id"],
            ["modifier_options.tenant_id", "modifier_options.id"],
            name="fk_option_consumptions_tenant_option",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ingredient_product_id"], ["products.tenant_id", "products.id"],
            name="fk_option_consumptions_tenant_ingredient",
        ),
        sa.UniqueConstraint(
            "modifier_option_id", "ingredient_product_id",
            name="uq_option_consumptions_ingredient",
        ),
        sa.CheckConstraint("quantity <> 0", name="ck_option_consumptions_quantity"),
    )
    for table, grants in _GRANTS.items():
        _secure(table, grants)
    # Recipe consumption is its own movement type so reports and refunds can tell
    # an ingredient used by a sold drink from a sale of the ingredient itself.
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale','adjustment','stock_take','purchase','transfer_in',"
        "'transfer_out','consumption')",
    )


def downgrade():
    # Keep recorded recipes and ingredient history; refuse once the feature is used.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM recipes) "
        "OR EXISTS (SELECT 1 FROM modifier_option_consumptions) "
        "OR EXISTS (SELECT 1 FROM inventory_movements WHERE movement_type = 'consumption') "
        "THEN RAISE EXCEPTION 'Cannot downgrade recorded recipes or ingredient consumption'; "
        "END IF; END $$;"
    )
    op.drop_constraint("ck_inventory_movements_type", "inventory_movements", type_="check")
    op.create_check_constraint(
        "ck_inventory_movements_type",
        "inventory_movements",
        "movement_type IN ('sale','adjustment','stock_take','purchase','transfer_in',"
        "'transfer_out')",
    )
    op.drop_table("modifier_option_consumptions")
    op.drop_table("recipe_lines")
    op.drop_index("ix_recipes_product_effective", table_name="recipes")
    op.drop_table("recipes")

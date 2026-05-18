"""harden modifier tenant isolation and foreign keys

Revision ID: 0019_modifier_integrity
Revises: 0018_onboarding_employees
Create Date: 2026-05-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0019_modifier_integrity"
down_revision: str | None = "0018_onboarding_employees"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tenant_policy(table_name: str) -> None:
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table_name}
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        """
    )


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM modifier_options mo
        WHERE NOT EXISTS (
            SELECT 1
            FROM modifier_groups mg
            WHERE mg.id = mo.group_id
                AND mg.tenant_id = mo.tenant_id
        )
        """
    )
    op.execute(
        """
        DELETE FROM product_modifier_groups pmg
        WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = pmg.product_id)
            OR NOT EXISTS (
                SELECT 1 FROM modifier_groups mg WHERE mg.id = pmg.modifier_group_id
            )
            OR EXISTS (
                SELECT 1
                FROM products p
                JOIN modifier_groups mg ON mg.id = pmg.modifier_group_id
                WHERE p.id = pmg.product_id
                    AND p.tenant_id <> mg.tenant_id
            )
        """
    )
    op.execute(
        """
        DELETE FROM order_item_modifiers oim
        WHERE NOT EXISTS (
            SELECT 1
            FROM order_items oi
            WHERE oi.id = oim.order_item_id
                AND oi.tenant_id = oim.tenant_id
        )
            OR NOT EXISTS (
                SELECT 1
                FROM modifier_groups mg
                WHERE mg.id = oim.modifier_group_id
                    AND mg.tenant_id = oim.tenant_id
            )
            OR NOT EXISTS (
                SELECT 1
                FROM modifier_options mo
                WHERE mo.id = oim.modifier_option_id
                    AND mo.tenant_id = oim.tenant_id
                    AND mo.group_id = oim.modifier_group_id
            )
        """
    )

    op.add_column("product_modifier_groups", sa.Column("tenant_id", sa.UUID(), nullable=True))
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_product_modifier_groups_tenant_id()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.tenant_id IS NULL THEN
                SELECT p.tenant_id INTO NEW.tenant_id
                FROM products p
                WHERE p.id = NEW.product_id;
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_product_modifier_groups_tenant_id
        BEFORE INSERT OR UPDATE OF product_id, tenant_id
        ON product_modifier_groups
        FOR EACH ROW
        EXECUTE FUNCTION set_product_modifier_groups_tenant_id()
        """
    )
    op.execute(
        """
        UPDATE product_modifier_groups pmg
        SET tenant_id = p.tenant_id
        FROM products p
        WHERE p.id = pmg.product_id
        """
    )
    op.alter_column("product_modifier_groups", "tenant_id", nullable=False)
    op.create_index(
        "ix_product_modifier_groups_tenant_id",
        "product_modifier_groups",
        ["tenant_id"],
    )

    op.drop_constraint(
        "uq_product_modifier_groups",
        "product_modifier_groups",
        type_="unique",
    )

    op.create_unique_constraint(
        "uq_products_tenant_id_id",
        "products",
        ["tenant_id", "id"],
    )
    op.create_unique_constraint(
        "uq_order_items_tenant_id_id",
        "order_items",
        ["tenant_id", "id"],
    )
    op.create_unique_constraint(
        "uq_modifier_groups_tenant_id_id",
        "modifier_groups",
        ["tenant_id", "id"],
    )
    op.create_unique_constraint(
        "uq_modifier_options_tenant_id_id",
        "modifier_options",
        ["tenant_id", "id"],
    )
    op.create_unique_constraint(
        "uq_product_modifier_groups",
        "product_modifier_groups",
        ["tenant_id", "product_id", "modifier_group_id"],
    )

    op.create_foreign_key(
        "fk_modifier_options_tenant",
        "modifier_options",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_modifier_options_tenant_group",
        "modifier_options",
        "modifier_groups",
        ["tenant_id", "group_id"],
        ["tenant_id", "id"],
    )
    op.create_foreign_key(
        "fk_product_modifier_groups_tenant",
        "product_modifier_groups",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_product_modifier_groups_tenant_product",
        "product_modifier_groups",
        "products",
        ["tenant_id", "product_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_product_modifier_groups_tenant_group",
        "product_modifier_groups",
        "modifier_groups",
        ["tenant_id", "modifier_group_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_order_item_modifiers_tenant",
        "order_item_modifiers",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_order_item_modifiers_tenant_order_item",
        "order_item_modifiers",
        "order_items",
        ["tenant_id", "order_item_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_order_item_modifiers_tenant_group",
        "order_item_modifiers",
        "modifier_groups",
        ["tenant_id", "modifier_group_id"],
        ["tenant_id", "id"],
    )
    op.create_foreign_key(
        "fk_order_item_modifiers_tenant_option",
        "order_item_modifiers",
        "modifier_options",
        ["tenant_id", "modifier_option_id"],
        ["tenant_id", "id"],
    )

    for table_name in (
        "audit_logs",
        "modifier_groups",
        "modifier_options",
        "product_modifier_groups",
        "order_item_modifiers",
    ):
        _tenant_policy(table_name)


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_product_modifier_groups_tenant_id "
        "ON product_modifier_groups"
    )
    op.execute("DROP FUNCTION IF EXISTS set_product_modifier_groups_tenant_id()")

    for constraint_name, table_name in (
        ("fk_order_item_modifiers_tenant_option", "order_item_modifiers"),
        ("fk_order_item_modifiers_tenant_group", "order_item_modifiers"),
        ("fk_order_item_modifiers_tenant_order_item", "order_item_modifiers"),
        ("fk_order_item_modifiers_tenant", "order_item_modifiers"),
        ("fk_product_modifier_groups_tenant_group", "product_modifier_groups"),
        ("fk_product_modifier_groups_tenant_product", "product_modifier_groups"),
        ("fk_product_modifier_groups_tenant", "product_modifier_groups"),
        ("fk_modifier_options_tenant_group", "modifier_options"),
        ("fk_modifier_options_tenant", "modifier_options"),
    ):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")

    op.drop_constraint(
        "uq_product_modifier_groups",
        "product_modifier_groups",
        type_="unique",
    )
    for constraint_name, table_name in (
        ("uq_modifier_options_tenant_id_id", "modifier_options"),
        ("uq_modifier_groups_tenant_id_id", "modifier_groups"),
        ("uq_order_items_tenant_id_id", "order_items"),
        ("uq_products_tenant_id_id", "products"),
    ):
        op.drop_constraint(constraint_name, table_name, type_="unique")

    op.create_unique_constraint(
        "uq_product_modifier_groups",
        "product_modifier_groups",
        ["product_id", "modifier_group_id"],
    )
    op.drop_index("ix_product_modifier_groups_tenant_id", table_name="product_modifier_groups")
    op.drop_column("product_modifier_groups", "tenant_id")

    for table_name in (
        "modifier_groups",
        "modifier_options",
        "order_item_modifiers",
    ):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table_name}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table_name} "
            "USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"
        )

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON audit_logs")
    op.execute(
        "CREATE POLICY tenant_isolation ON audit_logs "
        "USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)"
    )

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON product_modifier_groups")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON product_modifier_groups
        USING (
            EXISTS (
                SELECT 1
                FROM products p
                JOIN modifier_groups mg
                    ON mg.id = product_modifier_groups.modifier_group_id
                WHERE p.id = product_modifier_groups.product_id
                    AND p.tenant_id = current_setting('app.tenant_id', true)::uuid
                    AND mg.tenant_id = p.tenant_id
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM products p
                JOIN modifier_groups mg
                    ON mg.id = product_modifier_groups.modifier_group_id
                WHERE p.id = product_modifier_groups.product_id
                    AND p.tenant_id = current_setting('app.tenant_id', true)::uuid
                    AND mg.tenant_id = p.tenant_id
            )
        )
        """
    )

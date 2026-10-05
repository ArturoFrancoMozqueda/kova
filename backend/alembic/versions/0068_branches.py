"""branches, compatible historical attribution and branch-consistent operations

Revision ID: 0068_branches
Revises: 0067_runtime_grant_matrix
"""

import sqlalchemy as sa

from alembic import op

revision = "0068_branches"
down_revision = "0067_runtime_grant_matrix"
branch_labels = None
depends_on = None

_TABLES = (
    "shifts",
    "orders",
    "inventory_movements",
    "refunds",
    "voids",
    "cash_movements",
    "customer_orders",
    "inventory_reservations",
    "expenses",
)
_RELATIONS = (
    ("orders", "shift_id", "shifts", "fk_orders_tenant_shift"),
    ("inventory_movements", "order_id", "orders", "fk_inventory_movements_tenant_order"),
    ("refunds", "order_id", "orders", "fk_refunds_tenant_order"),
    ("voids", "order_id", "orders", "fk_voids_tenant_order"),
    ("cash_movements", "shift_id", "shifts", "fk_cash_movements_tenant_shift"),
    ("customer_orders", "sale_order_id", "orders", "fk_customer_orders_tenant_sale"),
    (
        "inventory_reservations",
        "customer_order_id",
        "customer_orders",
        "fk_inventory_reservations_tenant_order",
    ),
)


def upgrade():
    op.create_table(
        "branches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.String(300)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("tenant_id", "id", name="uq_branches_tenant_id_id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_branches_tenant_name"),
    )
    op.create_index("ix_branches_tenant_id", "branches", ["tenant_id"])
    op.execute(
        "INSERT INTO branches (id, tenant_id, name) SELECT id, id, 'Sucursal principal' FROM tenants"
    )
    # Invoker privileges only: signup already uses the privileged owner connection.
    op.execute("""
        CREATE FUNCTION kova_create_principal_branch() RETURNS trigger
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
        BEGIN
            INSERT INTO public.branches (id, tenant_id, name)
            VALUES (NEW.id, NEW.id, 'Sucursal principal');
            RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION kova_create_principal_branch() FROM PUBLIC;
        CREATE TRIGGER tenants_principal_branch AFTER INSERT ON tenants
        FOR EACH ROW EXECUTE FUNCTION kova_create_principal_branch();
    """)
    op.execute("""
        CREATE FUNCTION kova_default_operation_branch() RETURNS trigger
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
                RAISE EXCEPTION 'Registered operation branch is immutable' USING ERRCODE = '23514';
            END IF;
            IF NEW.branch_id IS NULL THEN NEW.branch_id := NEW.tenant_id; END IF;
            RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION kova_default_operation_branch() FROM PUBLIC;
    """)
    for table in _TABLES:
        op.add_column(table, sa.Column("branch_id", sa.Uuid(), nullable=True))
        op.execute(f"UPDATE {table} SET branch_id = tenant_id")
        op.alter_column(table, "branch_id", nullable=False)
        op.execute(
            f"CREATE TRIGGER {table}_default_branch BEFORE INSERT OR UPDATE OF branch_id ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION kova_default_operation_branch()"
        )
        # Older tables (notably shifts) did not reference tenants directly.
        # Retain rows whose tenant was already deleted without inventing a
        # business or discarding financial history. NOT VALID still enforces
        # the FK for every new row/key change; validate whenever history permits.
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_branch "
            "FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) NOT VALID"
        )
        op.execute(f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM {table} child
                    JOIN tenants tenant ON tenant.id = child.tenant_id
                    LEFT JOIN branches branch ON branch.tenant_id = child.tenant_id
                        AND branch.id = child.branch_id
                    WHERE branch.id IS NULL
                ) THEN
                    RAISE EXCEPTION 'Missing principal branch for existing tenant in {table}';
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM {table} child
                    LEFT JOIN branches branch ON branch.tenant_id = child.tenant_id
                        AND branch.id = child.branch_id
                    WHERE branch.id IS NULL
                ) THEN
                    ALTER TABLE {table} VALIDATE CONSTRAINT fk_{table}_branch;
                END IF;
            END $$;
        """)
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
    for table in ("shifts", "orders", "customer_orders"):
        op.create_unique_constraint(
            f"uq_{table}_tenant_branch_id", table, ["tenant_id", "branch_id", "id"]
        )
    for table, column, parent, name in _RELATIONS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(
            name,
            table,
            parent,
            ["tenant_id", "branch_id", column],
            ["tenant_id", "branch_id", "id"],
        )
    op.drop_index("uq_one_open_shift_per_tenant", table_name="shifts")
    op.create_index(
        "uq_one_open_shift_per_branch",
        "shifts",
        ["tenant_id", "branch_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )
    op.create_index(
        "ix_orders_branch_sale_time",
        "orders",
        ["tenant_id", "branch_id", sa.text("COALESCE(occurred_at, created_at)")],
    )
    op.create_index(
        "ix_inventory_branch_product",
        "inventory_movements",
        ["tenant_id", "branch_id", "product_id"],
    )
    op.execute("""
        ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
        ALTER TABLE branches FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON branches FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
        REVOKE ALL ON branches FROM PUBLIC;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON branches FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON branches FROM authenticated;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT SELECT, INSERT ON branches TO kova_app;
                GRANT UPDATE (name, address) ON branches TO kova_app;
            END IF;
        END $$;
    """)


def downgrade():
    # Refuse to erase branch attribution once users have created additional locations.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM branches WHERE id <> tenant_id) THEN
                RAISE EXCEPTION 'Cannot downgrade multi-location data; retain migration 0068';
            END IF;
        END $$;
    """)
    op.drop_index("ix_orders_branch_sale_time", table_name="orders")
    op.drop_index("ix_inventory_branch_product", table_name="inventory_movements")
    op.drop_index("uq_one_open_shift_per_branch", table_name="shifts")
    op.create_index(
        "uq_one_open_shift_per_tenant",
        "shifts",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )
    for table, column, parent, name in reversed(_RELATIONS):
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, parent, ["tenant_id", column], ["tenant_id", "id"])
    for table in ("shifts", "orders", "customer_orders"):
        op.drop_constraint(f"uq_{table}_tenant_branch_id", table, type_="unique")
    for table in reversed(_TABLES):
        op.drop_index(f"ix_{table}_branch_id", table_name=table)
        op.drop_constraint(f"fk_{table}_branch", table, type_="foreignkey")
        op.execute(f"DROP TRIGGER {table}_default_branch ON {table}")
        op.drop_column(table, "branch_id")
    op.execute(
        "DROP TRIGGER tenants_principal_branch ON tenants; DROP FUNCTION kova_create_principal_branch()"
    )
    op.execute("DROP FUNCTION kova_default_operation_branch()")
    op.drop_table("branches")

"""Explicit product publication with revocable scoped share links."""

import sqlalchemy as sa

from alembic import op

revision = "0082_public_catalog"
down_revision = "0081_commercial_crm"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_catalogs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.String(500)),
        sa.Column("whatsapp_phone", sa.String(15)),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("link_version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", name="uq_public_catalog_branch"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_public_catalog_tenant_id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
    )
    op.create_table(
        "public_catalog_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("catalog_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.UniqueConstraint("catalog_id", "product_id", name="uq_public_catalog_item_product"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "catalog_id"], ["public_catalogs.tenant_id", "public_catalogs.id"]
        ),
        sa.ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )
    op.create_index("ix_public_catalogs_branch_id", "public_catalogs", ["branch_id"])
    for table in ("public_catalogs", "public_catalog_items"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text = current_setting('app.tenant_id', true))
            WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        for role in ("anon", "authenticated", "service_role"):
            op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}')
                THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$;""")
        privileges = (
            "SELECT, INSERT, UPDATE" if table == "public_catalogs" else "SELECT, INSERT, DELETE"
        )
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app')
            THEN GRANT {privileges} ON {table} TO kova_app; END IF; END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM public_catalogs) THEN
        RAISE EXCEPTION 'Cannot discard publication records'; END IF; END $$;""")
    op.drop_table("public_catalog_items")
    op.drop_table("public_catalogs")

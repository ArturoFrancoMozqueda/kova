"""Readable, immutable public catalog routes without exposing private tenant tables."""

import re
import unicodedata

import sqlalchemy as sa

from alembic import op

revision = "0093_readable_catalog_links"
down_revision = "0092_product_image_thumbnails"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_catalog_links",
        sa.Column("slug", sa.String(100), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("catalog_id", sa.Uuid(), nullable=False),
        sa.Column("link_version", sa.Integer(), nullable=False),
        sa.UniqueConstraint("catalog_id", "link_version", name="uq_catalog_link_version"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "catalog_id"], ["public_catalogs.tenant_id", "public_catalogs.id"]
        ),
    )
    op.create_index("ix_public_catalog_links_tenant_id", "public_catalog_links", ["tenant_id"])
    # Existing QR codes remain valid. Allocate a readable route for the current version too.
    connection = op.get_bind()
    rows = connection.execute(sa.text("""
        SELECT c.id, c.tenant_id, c.link_version, t.name FROM public_catalogs c
        JOIN tenants t ON t.id = c.tenant_id ORDER BY c.tenant_id, c.branch_id
    """))
    used = set()
    for row in rows:
        base = unicodedata.normalize("NFKD", row.name).encode("ascii", "ignore").decode()
        base = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:80].rstrip("-") or "negocio"
        slug, suffix = base, 1
        while slug in used:
            suffix += 1
            slug = f"{base}-{suffix}"
        used.add(slug)
        connection.execute(sa.text("""INSERT INTO public_catalog_links
            (slug, tenant_id, catalog_id, link_version) VALUES (:slug, :tenant, :catalog, :version)
        """), {"slug": slug, "tenant": row.tenant_id, "catalog": row.id, "version": row.link_version})
    op.execute("ALTER TABLE public_catalog_links ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public_catalog_links FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation ON public_catalog_links FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    # Only immutable routing IDs for an exact requested slug; no product/customer data.
    op.execute("""CREATE POLICY exact_public_catalog_route ON public_catalog_links FOR SELECT
        USING (slug::text = current_setting('app.public_catalog_slug', true))""")
    op.execute("REVOKE ALL ON public_catalog_links FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}')
            THEN REVOKE ALL ON public_catalog_links FROM {role}; END IF; END $$;""")
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app')
        THEN GRANT SELECT, INSERT ON public_catalog_links TO kova_app; END IF; END $$;""")


def downgrade():
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM public_catalog_links) THEN
        RAISE EXCEPTION 'Cannot discard public route reservations'; END IF; END $$;""")
    op.drop_table("public_catalog_links")

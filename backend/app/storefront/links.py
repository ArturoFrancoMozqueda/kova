import re
import unicodedata

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from app.storefront.models import PublicCatalogLink


def lookup_link(db, slug):
    # Only this exact public route becomes visible, not a directory of businesses.
    db.execute(text("SELECT set_config('app.public_catalog_slug', :slug, true)"), {"slug": slug})
    try:
        return db.query(PublicCatalogLink).filter_by(slug=slug).first()
    finally:
        db.execute(text("SELECT set_config('app.public_catalog_slug', '', true)"))


def allocate_link(db, catalog, business_name):
    base = unicodedata.normalize("NFKD", business_name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:80].rstrip("-") or "negocio"
    # ON CONFLICT serializes identical names across tenants.
    # Revoked aliases remain reserved while their account exists.
    suffix = 1
    while True:
        slug = base if suffix == 1 else f"{base}-{suffix}"
        created = db.execute(
            insert(PublicCatalogLink).values(
                slug=slug, tenant_id=catalog.tenant_id, catalog_id=catalog.id,
                link_version=catalog.link_version,
            ).on_conflict_do_nothing(index_elements=["slug"]).returning(PublicCatalogLink.slug)
        ).scalar_one_or_none()
        if created:
            return slug
        suffix += 1

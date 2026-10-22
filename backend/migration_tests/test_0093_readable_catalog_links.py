"""Readable routes backfill existing publications without changing revocation versions."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_backfill_normalizes_collisions_preserves_versions_and_blocks_route_loss():
    with _database() as (url, engine):
        before = _migrate(url, "upgrade", "0092_product_image_thumbnails")
        assert before.returncode == 0, before.stderr
        tenants = [uuid4(), uuid4()]
        with engine.begin() as conn:
            for tenant in tenants:
                conn.execute(text("INSERT INTO tenants(id,name,slug) "
                                  "VALUES(:id,'Cafetería Sweet Home',:slug)"),
                             {"id": tenant, "slug": str(tenant)})
                conn.execute(text("""INSERT INTO public_catalogs
                    (id,tenant_id,branch_id,title,enabled,version,link_version,updated_at)
                    VALUES(:id,:tenant,:tenant,'Catálogo',true,4,3,now())"""),
                             {"id": uuid4(), "tenant": tenant})
        migrated = _migrate(url, "upgrade", "head")
        assert migrated.returncode == 0, migrated.stderr
        with engine.connect() as conn:
            routes = set(conn.execute(text("SELECT slug,link_version FROM public_catalog_links")))
            assert routes == {
                ("cafeteria-sweet-home", 3), ("cafeteria-sweet-home-2", 3),
            }
            versions = set(conn.execute(text("SELECT version,link_version FROM public_catalogs")))
            assert versions == {(4, 3)}
        blocked = _migrate(url, "downgrade", "0092_product_image_thumbnails")
        assert blocked.returncode != 0
        assert "Cannot discard public route reservations" in blocked.stderr


def test_empty_routes_can_be_downgraded_and_reapplied():
    with _database() as (url, _engine):
        assert _migrate(url, "upgrade", "head").returncode == 0
        assert _migrate(url, "downgrade", "0092_product_image_thumbnails").returncode == 0
        assert _migrate(url, "upgrade", "head").returncode == 0

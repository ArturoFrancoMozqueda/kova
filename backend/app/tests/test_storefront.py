import io
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import event, text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.catalog.models import Product
from app.storefront.models import PublicCatalog, PublicCatalogLink
from app.tests.test_customer_orders import _product, _seed, _signup_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _save(client, products, *, version=0, enabled=True, key=None, **extra):
    return client.put(
        "/api/v1/storefront/settings",
        headers={"Idempotency-Key": key or f"publish-{uuid4()}"},
        json={
            "expected_version": version,
            "enabled": enabled,
            "title": "Pan de la casa",
            "product_ids": [p["id"] for p in products],
            **extra,
        },
    )


def _read(client, result):
    return client.get(result["share_path"].replace("/catalogo/", "/api/v1/public/catalog/"))


def _seed_legacy_link_replacement(db, tenant_id):
    """Represent a replacement made before fixed links; no current API can do it."""
    catalog = db.query(PublicCatalog).filter_by(tenant_id=tenant_id).one()
    previous = db.query(PublicCatalogLink).filter_by(
        catalog_id=catalog.id, link_version=catalog.link_version,
    ).one()
    catalog.link_version += 1
    db.add(PublicCatalogLink(
        slug=f"{previous.slug}-2", tenant_id=tenant_id,
        catalog_id=catalog.id, link_version=catalog.link_version,
    ))
    db.commit()


def _upload_photo(client, product):
    output = io.BytesIO()
    Image.new("RGB", (6, 4), "red").save(output, "PNG")
    response = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("producto.png", output.getvalue(), "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()["image_url"], output.getvalue()


def test_public_photo_projection_preserves_crop_and_defaults_without_loading_blobs(client, db):
    _signup_login(client, prefix="catalog-photo")
    product = _product(client, name="Pan con foto")
    without_photo = _product(client, name="Pan sin foto")
    image_url, image_bytes = _upload_photo(client, product)
    updated = client.patch(f"/api/v1/catalog/products/{product['id']}", headers={
        "Idempotency-Key": f"crop-{uuid4()}",
    }, json={
        "image_position_x": 17, "image_position_y": 82, "image_zoom": 1.75,
    })
    assert updated.status_code == 200, updated.text
    saved = _save(client, [product, without_photo])
    assert saved.status_code == 200, saved.text
    client.cookies.clear()
    statements = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lower())

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        response = _read(client, saved.json())
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    assert response.status_code == 200, response.text
    products = {row["id"]: row for row in response.json()["products"]}
    assert products[product["id"]] == {
        "id": product["id"], "name": product["name"], "description": None,
        "price_amount": product["price_amount"], "availability": "unavailable",
        "image_url": image_url, "image_position_x": 17, "image_position_y": 82,
        "image_zoom": 1.75,
    }
    plain = products[without_photo["id"]]
    assert plain["image_url"] is None
    assert (plain["image_position_x"], plain["image_position_y"], plain["image_zoom"]) == (50, 50, 1.0)
    assert statements and not any("product_image_files" in sql for sql in statements)
    image = client.get(products[product["id"]]["image_url"])
    assert image.status_code == 200
    assert image.content == image_bytes
    assert "no-store" in response.headers["Cache-Control"]


def test_public_photos_exclude_unpublished_inactive_and_foreign_products(client, db):
    _signup_login(client, prefix="catalog-photo-scope-a")
    selected = _product(client, name="Foto publicada")
    hidden = _product(client, name="Foto privada")
    inactive = _product(client, name="Foto retirada")
    selected_image, _ = _upload_photo(client, selected)
    hidden_image, _ = _upload_photo(client, hidden)
    inactive_image, _ = _upload_photo(client, inactive)
    saved = _save(client, [selected, inactive])
    assert saved.status_code == 200, saved.text
    deactivated = client.patch(f"/api/v1/catalog/products/{inactive['id']}",
                               headers={"Idempotency-Key": f"deactivate-{uuid4()}"},
                               json={"is_active": False})
    assert deactivated.status_code == 200, deactivated.text
    client.cookies.clear()
    _signup_login(client, prefix="catalog-photo-scope-b")
    foreign = _product(client, name="Foto de otro negocio")
    foreign_image, _ = _upload_photo(client, foreign)
    assert _save(client, [foreign]).status_code == 200
    response = _read(client, saved.json())
    assert response.status_code == 200, response.text
    assert [product["id"] for product in response.json()["products"]] == [selected["id"]]
    assert response.json()["products"][0]["image_url"] == selected_image
    for private_image in (hidden_image, inactive_image, foreign_image):
        assert private_image not in response.text
    for private_field in ("tenant_id", "cost_price", "stock_on_hand", "sku", "bytes_data"):
        assert private_field not in response.text


def test_catalog_is_opt_in_and_only_selected_projection_is_public(client, db):
    tenant_id = _signup_login(client, prefix="catalog-optin")
    assert client.get("/api/v1/storefront/settings").json()["share_path"] is None
    selected = _product(client, name="Pan publicado")
    _product(client, name="Producto privado")
    _seed(client, selected["id"], 4)
    saved = _save(client, [selected], whatsapp_phone="525555555555")
    assert saved.status_code == 200, saved.text
    public = _read(client, saved.json())
    assert public.status_code == 200, public.text
    body = public.json()
    assert body["checkout_available"] is False
    assert [p["name"] for p in body["products"]] == ["Pan publicado"]
    assert body["products"][0]["availability"] == "available"
    for forbidden in ("tenant_id", "cost_price", "stock_on_hand", "customer_phone", "sku"):
        assert forbidden not in public.text
    assert "no-store" in public.headers["Cache-Control"]
    assert db.query(PublicCatalog).filter_by(tenant_id=tenant_id).count() == 1


def test_withdraw_and_republish_preserve_public_link_and_qr(client, db):
    tenant_id = _signup_login(client, prefix="catalog-revoke")
    product = _product(client)
    first = _save(client, [product]).json()
    qr = client.get("/api/v1/storefront/qr")
    assert qr.status_code == 200
    withdrawn = _save(client, [product], version=first["version"], enabled=False)
    assert withdrawn.status_code == 200
    assert withdrawn.json()["share_path"] is None
    assert _read(client, first).status_code == 404
    assert client.get("/api/v1/storefront/qr").status_code == 404
    republished = _save(client, [product], version=withdrawn.json()["version"],
                        title="Menú actualizado")
    assert republished.status_code == 200, republished.text
    assert republished.json()["share_path"] == first["share_path"]
    assert _read(client, first).json()["title"] == "Menú actualizado"
    assert client.get("/api/v1/storefront/qr").content == qr.content
    assert db.query(PublicCatalog).filter_by(tenant_id=tenant_id).count() == 1
    assert db.query(PublicCatalogLink).filter_by(tenant_id=tenant_id).count() == 1


@pytest.mark.parametrize("published", [False, True])
def test_link_replacement_is_rejected_without_creating_aliases(client, db, published):
    tenant_id = _signup_login(client, prefix="catalog-fixed")
    product = _product(client)
    before = _save(client, [product]).json() if published else None
    response = _save(client, [product], version=before["version"] if before else 0,
                     title="Cambio no permitido", rotate_link=True)
    assert response.status_code == 422, response.text
    assert any(error["loc"] == ["body", "rotate_link"] for error in response.json()["detail"])
    assert db.query(PublicCatalogLink).filter_by(tenant_id=tenant_id).count() == int(published)
    assert db.query(PublicCatalog).filter_by(tenant_id=tenant_id).count() == int(published)
    current = client.get("/api/v1/storefront/settings").json()
    if before:
        assert current == before
        assert _read(client, before).status_code == 200
    else:
        assert current["version"] == 0 and current["share_path"] is None


def test_public_link_does_not_authorize_a_private_session(client, db):
    _signup_login(client, prefix="catalog-session")
    product = _product(client)
    result = _save(client, [product]).json()
    token = result["share_path"].rsplit("/", 1)[-1]
    client.cookies.clear()
    assert _read(client, result).status_code == 200
    client.cookies.set("access_token", token)
    assert client.get("/api/v1/customers").status_code == 401
    assert client.get("/api/v1/public/catalog/tampered").status_code == 404


def test_publication_rejects_foreign_products_and_stale_updates(client, db):
    _signup_login(client, prefix="catalog-foreign-a")
    foreign = _product(client)
    client.cookies.clear()
    _signup_login(client, prefix="catalog-foreign-b")
    own = _product(client)
    assert _save(client, [foreign]).status_code == 400
    first = _save(client, [own])
    assert first.status_code == 200
    assert _save(client, [own], version=0).status_code == 409
    assert client.get("/api/v1/storefront/settings").json()["version"] == 1


def test_publish_retry_is_idempotent_and_deactivated_products_disappear(client, db):
    tenant_id = _signup_login(client, prefix="catalog-retry")
    product = _product(client)
    key = f"publication-{uuid4()}"
    first = _save(client, [product], key=key)
    replay = _save(client, [product], key=key)
    assert replay.status_code == 200
    assert replay.json() == first.json()
    row = db.query(Product).filter_by(tenant_id=tenant_id, id=product["id"]).one()
    row.is_active = False
    db.commit()
    assert _read(client, first.json()).json()["products"] == []


def test_inactive_business_withdraws_catalog_and_qr_is_private(client, db):
    from app.tenants.models import Tenant

    tenant_id = _signup_login(client, prefix="catalog-inactive")
    assert client.get("/api/v1/storefront/qr").status_code == 404
    product = _product(client)
    result = _save(client, [product]).json()
    qr = client.get("/api/v1/storefront/qr")
    assert qr.status_code == 200
    assert qr.content.startswith(b"\x89PNG")
    assert "no-store" in qr.headers["Cache-Control"]
    tenant = db.query(Tenant).filter_by(id=tenant_id).one()
    tenant.is_active = False
    db.commit()
    assert _read(client, result).status_code == 404


def test_public_catalog_hidden_when_billing_expires(client, db):
    tenant_id = _signup_login(client, prefix="catalog-billing")
    product = _product(client)
    result = _save(client, [product]).json()
    db.add(Subscription(tenant_id=tenant_id, status="canceled"))
    db.commit()
    assert _read(client, result).status_code == 404
    assert client.get("/api/v1/storefront/settings").status_code == 402


def test_cashier_cannot_publish_and_schema_rejects_unsafe_content(client, db):
    tenant_id = _signup_login(client, prefix="catalog-roles")
    product = _product(client)
    assert _save(client, [product], title="<script>bad</script>").status_code == 422
    assert _save(client, [product], whatsapp_phone="javascript:bad").status_code == 422
    member = db.query(Membership).filter_by(tenant_id=tenant_id).one()
    member.role = "cashier"
    db.commit()
    assert _save(client, [product]).status_code == 403


def test_publication_tables_enforce_rls_under_runtime_role(
    client, db, owner_engine, kova_app_engine
):
    from sqlalchemy.orm import Session

    from app.db import set_tenant_context

    tenant_id = _signup_login(client, prefix="catalog-rls")
    product = _product(client)
    assert _save(client, [product]).status_code == 200
    # RLS posture query runs on the real schema; committed multi-tenant data is
    # covered by the independent runtime-engine domain tests as well.
    with kova_app_engine.connect() as connection:
        for table in ("public_catalogs", "public_catalog_items"):
            connection.execute(
                text("SELECT set_config('app.tenant_id', :id, true)"), {"id": str(uuid4())}
            )
            assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar() == 0
    with Session(owner_engine) as session:
        set_tenant_context(session, tenant_id)
        flags = session.execute(
            text(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relname='public_catalogs'"
            )
        ).one()
        assert tuple(flags) == (True, True)


def test_readable_business_name_is_stable_and_revoked_names_are_reserved(client, db):
    from app.tenants.models import Tenant

    first_tenant = _signup_login(client, prefix="readable-a")
    db.query(Tenant).filter_by(id=first_tenant).one().name = "Cafetería Sweet Home"
    db.commit()
    product = _product(client)
    first = _save(client, [product]).json()
    assert first["share_path"] == "/catalogo/cafeteria-sweet-home"
    _seed_legacy_link_replacement(db, first_tenant)
    rotated = client.get("/api/v1/storefront/settings").json()
    assert rotated["share_path"] == "/catalogo/cafeteria-sweet-home-2"
    updated = _save(client, [product], version=1, title="Otro título").json()
    assert updated["share_path"] == rotated["share_path"]
    assert _read(client, first).status_code == 404
    client.cookies.clear()
    second_tenant = _signup_login(client, prefix="readable-b")
    db.query(Tenant).filter_by(id=second_tenant).one().name = "Cafetería Sweet Home"
    db.commit()
    second = _save(client, [_product(client)]).json()
    assert second["share_path"] == "/catalogo/cafeteria-sweet-home-3"
    assert _read(client, first).status_code == 404
    assert _read(client, rotated).status_code == 200
    assert _read(client, second).status_code == 200


def test_legacy_printed_capability_preserves_validity_and_historical_revocation(client, db):
    import jwt

    from app.config import settings

    tenant_id = _signup_login(client, prefix="legacy-link")
    product = _product(client)
    current = _save(client, [product]).json()
    catalog = db.query(PublicCatalog).filter_by(tenant_id=tenant_id).one()
    token = jwt.encode({"aud": "kova-public-catalog", "tenant": str(tenant_id),
                        "branch": str(catalog.branch_id), "catalog": str(catalog.id),
                        "version": catalog.link_version}, settings.secret_key, algorithm="HS256")
    assert client.get(f"/api/v1/public/catalog/{token}").status_code == 200
    updated = _save(client, [product], version=current["version"], title="Título nuevo").json()
    assert updated["share_path"] == current["share_path"]
    assert client.get(f"/api/v1/public/catalog/{token}").json()["title"] == "Título nuevo"
    _seed_legacy_link_replacement(db, tenant_id)
    historical = client.get("/api/v1/storefront/settings").json()
    saved = _save(client, [product], version=updated["version"]).json()
    assert saved["share_path"] == historical["share_path"]
    assert _read(client, current).status_code == 404
    assert client.get(f"/api/v1/public/catalog/{token}").status_code == 404


def test_readable_lookup_uses_runtime_rls_and_cannot_enumerate_or_modify(client, db, kova_app_engine):
    from app.db import set_tenant_context
    from app.storefront.links import lookup_link
    from app.storefront.models import PublicCatalogLink
    from app.storefront.router import resolve_public_catalog

    tenant_id = _signup_login(client, prefix="route-rls")
    current = _save(client, [_product(client)]).json()
    slug = current["share_path"].split("/")[-1]
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        set_tenant_context(db, uuid4())
        assert db.query(PublicCatalogLink).count() == 0
        assert lookup_link(db, "unknown-business") is None
        assert lookup_link(db, slug).tenant_id == tenant_id
        assert db.query(PublicCatalogLink).count() == 0  # lookup context was cleared
        assert db.query(PublicCatalog).count() == 0
        assert db.query(Product).count() == 0
        assert db.execute(text("SELECT has_table_privilege(current_user, 'public_catalog_links', 'UPDATE')")).scalar() is False
        assert db.execute(text("SELECT has_table_privilege(current_user, 'public_catalog_links', 'DELETE')")).scalar() is False
        assert resolve_public_catalog(db, slug).tenant_id == tenant_id
    finally:
        db.execute(text("RESET ROLE"))


def test_concurrent_businesses_reserve_distinct_readable_names(owner_engine, kova_app_engine):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from types import SimpleNamespace

    from sqlalchemy.orm import Session

    from app.db import set_tenant_context
    from app.storefront.links import allocate_link

    tenants = [uuid4(), uuid4()]
    catalogs = [uuid4(), uuid4()]
    name = f"Concurrent {uuid4().hex}"
    with owner_engine.begin() as conn:
        for tenant, catalog in zip(tenants, catalogs, strict=True):
            conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES(:id,:name,:slug)"),
                         {"id": tenant, "name": name, "slug": str(tenant)})
            conn.execute(text("""INSERT INTO public_catalogs
                (id,tenant_id,branch_id,title,enabled,version,link_version,updated_at)
                VALUES(:id,:tenant,:tenant,'Concurrent',true,1,1,now())"""),
                         {"id": catalog, "tenant": tenant})
    barrier = Barrier(2)

    def reserve(pair):
        tenant, catalog = pair
        with Session(kova_app_engine) as session:
            set_tenant_context(session, tenant)
            barrier.wait(timeout=10)
            slug = allocate_link(session, SimpleNamespace(
                id=catalog, tenant_id=tenant, link_version=1,
            ), name)
            session.commit()
            return slug

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            slugs = set(executor.map(reserve, zip(tenants, catalogs, strict=True)))
        base = name.lower().replace(" ", "-")
        assert slugs == {base, f"{base}-2"}
    finally:
        with owner_engine.begin() as conn:
            for tenant in tenants:
                for table in ("public_catalog_links", "public_catalogs", "branches"):
                    conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant})
                conn.execute(text("DELETE FROM tenants WHERE id=:tenant"), {"tenant": tenant})

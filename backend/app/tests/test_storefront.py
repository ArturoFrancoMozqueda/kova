from uuid import uuid4

import pytest
from sqlalchemy import text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.catalog.models import Product
from app.storefront.models import PublicCatalog
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


def test_withdraw_and_rotate_invalidate_public_links(client, db):
    _signup_login(client, prefix="catalog-revoke")
    product = _product(client)
    first = _save(client, [product]).json()
    rotated = _save(client, [product], version=first["version"], rotate_link=True)
    assert rotated.status_code == 200, rotated.text
    assert _read(client, first).status_code == 404
    assert _read(client, rotated.json()).status_code == 200
    withdrawn = _save(client, [product], version=rotated.json()["version"], enabled=False)
    assert withdrawn.status_code == 200
    assert withdrawn.json()["share_path"] is None
    assert _read(client, rotated.json()).status_code == 404


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

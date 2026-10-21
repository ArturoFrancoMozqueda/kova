import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.auth.models import Membership, UserSession
from app.catalog import image_router as images
from app.catalog.models import Product, ProductImageFile
from app.tests.test_catalog import _signup_verify_login
from app.tests.test_product_image_cache_reads import photo

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def product_with_owner(client):
    signup = _signup_verify_login(client, f"image-prep-{UUID(int=1)}@example.com", "Photo preparation")
    product = client.post("/api/v1/catalog/products", headers={"Idempotency-Key": "image-prep-product"},
                          json={"name": "Pan de nuez", "price_amount": "25.00"}).json()
    return signup, product


def test_upload_prepares_persistent_variants_before_first_public_read(client, db, monkeypatch):
    _signup, product = product_with_owner(client)
    prepare = images._prepare_upload_variants
    calls = []

    def checked_prepare(data, content_type):
        assert not db.in_transaction(), "Decode retained request transaction"
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()  # CPU work must not run on ASGI's loop.
        calls.append(True)
        return prepare(data, content_type)

    monkeypatch.setattr(images, "_prepare_upload_variants", checked_prepare)
    upload = client.post(f"/api/v1/catalog/products/{product['id']}/image",
                         files={"file": ("photo.png", photo("red"), "image/png")})
    assert upload.status_code == 200, upload.text
    assert calls == [True]
    row = db.query(ProductImageFile).filter_by(product_id=UUID(product["id"])).one()
    assert set(row.thumbnail_variants) == {"160", "320", "400"}
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0
    monkeypatch.setattr(images, "_resize_to_width", lambda *_: pytest.fail("First read decoded image"))
    first = client.get(upload.json()["image_url"] + "&w=160")
    assert first.status_code == 200
    assert first.headers["content-type"].startswith("image/webp")
    assert "image-resize;dur=0.000" in first.headers["server-timing"]


@pytest.mark.parametrize("change,status", [("revoke", 401), ("role", 403)])
def test_upload_revalidates_authority_changed_during_preparation(client, db, monkeypatch, change, status):
    signup, product = product_with_owner(client)
    prepare = images._prepare_upload_variants

    def changed_authority(data, content_type):
        assert not db.in_transaction()
        if change == "revoke":
            db.query(UserSession).filter_by(user_id=UUID(signup["user_id"])).update(
                {"revoked_at": datetime.now(UTC)}, synchronize_session=False,
            )
        else:
            db.query(Membership).filter_by(user_id=UUID(signup["user_id"])).update(
                {"role": "cashier"}, synchronize_session=False,
            )
        db.commit()
        return prepare(data, content_type)

    monkeypatch.setattr(images, "_prepare_upload_variants", changed_authority)
    result = client.post(f"/api/v1/catalog/products/{product['id']}/image",
                         files={"file": ("photo.png", photo("red"), "image/png")})
    assert result.status_code == status, result.text
    assert db.query(ProductImageFile).filter_by(product_id=UUID(product["id"])).count() == 0
    assert db.get(Product, UUID(product["id"])).image_url is None


def test_workers_upload_preparation_keeps_original_fallback(monkeypatch):
    monkeypatch.setattr(images.sys, "platform", "emscripten")
    monkeypatch.setattr(images, "_resize_to_width", lambda *_: pytest.fail("Workers invoked Pillow"))
    assert images._prepare_upload_variants(b"synthetic", "image/png") is None

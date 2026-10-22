import hashlib
import io
import re
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import event, update

from app.catalog import image_router as images
from app.catalog.models import Product, ProductImageFile
from app.tenants.models import Tenant


def photo(color):
    output = io.BytesIO()
    with Image.new("RGB", (800, 600), color) as image:
        image.save(output, "PNG")
    return output.getvalue()


@pytest.fixture(autouse=True)
def empty_thumbnail_cache():
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0
    yield
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0


@pytest.fixture
def stored_image(db):
    tenant_id, product_id = uuid4(), uuid4()
    first, second = photo("red"), photo("blue")
    # Valid PNGs may contain trailing bytes: keep byte_size equal while changing
    # their actual pixels, so neither size nor the deliberately fixed time helps.
    size = max(len(first), len(second))
    first, second = first.ljust(size, b"\0"), second.ljust(size, b"\0")
    db.add(Tenant(id=tenant_id, name="Thumbnail test", slug=str(tenant_id)))
    db.flush()
    db.add(Product(id=product_id, tenant_id=tenant_id, name="Photo", price_amount=10))
    db.flush()
    row = ProductImageFile(
        tenant_id=tenant_id, product_id=product_id, bytes_data=first,
        content_type="image/png", byte_size=size,
        updated_at=datetime(2026, 10, 21, tzinfo=UTC),
    )
    db.add(row)
    db.commit()
    return SimpleNamespace(product_id=product_id, image_id=row.id,
                           updated_at=row.updated_at, first=first, second=second)


def test_postgres_fingerprint_hit_transfers_no_blob_or_python_hash(db, stored_image, monkeypatch):
    first = images._load_product_image(stored_image.product_id, db, 160)
    statements = []
    bind = db.get_bind()

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lower().startswith("select "):
            statements.append(statement.lower())

    event.listen(bind, "before_cursor_execute", capture)
    hash_spy = MagicMock(wraps=hashlib.sha256)
    close_spy = MagicMock(wraps=db.close)
    monkeypatch.setattr(images, "hashlib", SimpleNamespace(sha256=hash_spy))
    monkeypatch.setattr(db, "close", close_spy)
    try:
        cached = images._load_product_image(stored_image.product_id, db, 160)
    finally:
        event.remove(bind, "before_cursor_execute", capture)

    assert cached.body == first.body
    assert len(statements) == 1
    assert "pg_catalog.sha256(product_image_files.bytes_data)" in statements[0]
    assert "select product_image_files.bytes_data" not in statements[0]
    assert "product_image_files.tenant_id = products.tenant_id" in statements[0]
    assert "products.is_active is true" in statements[0]
    hash_spy.assert_not_called()
    close_spy.assert_called_once()
    assert re.fullmatch(
        r"image-db;dur=\d+\.\d{3}, image-cache;dur=\d+\.\d{3}, image-resize;dur=0\.000",
        cached.headers["server-timing"],
    )
    assert cached.headers["cache-control"] == "public, max-age=86400"


def test_same_id_timestamp_size_and_mime_replacement_uses_actual_contents(db, stored_image):
    original = images._load_product_image(stored_image.product_id, db, 160)
    db.execute(update(ProductImageFile).where(ProductImageFile.id == stored_image.image_id).values(
        bytes_data=stored_image.second, updated_at=stored_image.updated_at,
    ))
    db.commit()
    replacement = images._load_product_image(stored_image.product_id, db, 160)
    assert replacement.body != original.body
    with Image.open(io.BytesIO(replacement.body)) as image:
        red, _green, blue = image.convert("RGB").getpixel((80, 60))
        assert blue > red
    assert images._load_product_image(stored_image.product_id, db, 160).body == replacement.body


@pytest.mark.parametrize("change", ["deactivate", "delete"])
def test_warm_thumbnail_cannot_bypass_current_visibility(db, stored_image, change):
    images._load_product_image(stored_image.product_id, db, 160)
    if change == "deactivate":
        db.execute(update(Product).where(Product.id == stored_image.product_id).values(is_active=False))
    else:
        row = db.get(ProductImageFile, stored_image.image_id)
        db.delete(row)
    db.commit()
    with pytest.raises(HTTPException) as error:
        images._load_product_image(stored_image.product_id, db, 160)
    assert error.value.status_code == 404


def test_replacement_between_fingerprint_and_blob_does_not_poison_cache(db, stored_image, monkeypatch):
    execute = db.execute
    replaced = False

    def racing_execute(statement, *args, **kwargs):
        nonlocal replaced
        result = execute(statement, *args, **kwargs)
        if not replaced and "pg_catalog.sha256" in str(statement):
            fingerprint_row = result.one_or_none()
            execute(update(ProductImageFile).where(ProductImageFile.id == stored_image.image_id).values(
                bytes_data=stored_image.second, updated_at=stored_image.updated_at,
            ))
            db.commit()
            replaced = True
            return SimpleNamespace(one_or_none=lambda: fingerprint_row)
        return result

    monkeypatch.setattr(db, "execute", racing_execute)
    response = images._load_product_image(stored_image.product_id, db, 160)
    assert replaced
    old_key = (hashlib.sha256(stored_image.first).digest(), "image/png", 160)
    new_key = (hashlib.sha256(stored_image.second).digest(), "image/png", 160)
    assert old_key not in images._resized_images
    assert images._resized_images[new_key][0] == response.body
    assert images._load_product_image(stored_image.product_id, db, 160).body == response.body


def test_deletion_between_fingerprint_and_blob_does_not_return_stale_thumbnail(db, stored_image, monkeypatch):
    execute = db.execute
    deleted = False

    def racing_execute(statement, *args, **kwargs):
        nonlocal deleted
        result = execute(statement, *args, **kwargs)
        if not deleted and "pg_catalog.sha256" in str(statement):
            fingerprint_row = result.one_or_none()
            db.delete(db.get(ProductImageFile, stored_image.image_id))
            db.commit()
            deleted = True
            return SimpleNamespace(one_or_none=lambda: fingerprint_row)
        return result

    monkeypatch.setattr(db, "execute", racing_execute)
    with pytest.raises(HTTPException) as error:
        images._load_product_image(stored_image.product_id, db, 160)
    assert error.value.status_code == 404
    assert deleted and not images._resized_images


def test_thumbnail_widths_remain_independent(db, stored_image):
    small = images._load_product_image(stored_image.product_id, db, 160)
    large = images._load_product_image(stored_image.product_id, db, 320)
    with Image.open(io.BytesIO(small.body)) as image:
        assert image.width == 160
    with Image.open(io.BytesIO(large.body)) as image:
        assert image.width == 320
    assert images._load_product_image(stored_image.product_id, db, 160).body == small.body
    assert images._load_product_image(stored_image.product_id, db, 320).body == large.body


@pytest.mark.parametrize("platform,dialect", [("emscripten", "postgresql"), ("darwin", "sqlite")])
def test_unsupported_runtime_keeps_original_blob_path(monkeypatch, platform, dialect):
    db = MagicMock()
    db.get_bind.return_value.dialect.name = dialect
    db.execute.return_value.one_or_none.return_value = (b"invalid", "image/png")
    monkeypatch.setattr(images.sys, "platform", platform)
    response = images._load_product_image(uuid4(), db, 160)
    assert response.body == b"invalid"
    db.execute.assert_called_once()
    assert "sha256" not in str(db.execute.call_args.args[0])

import asyncio
import base64
import hashlib
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import delete, event, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.catalog import image_router as images
from app.catalog.models import Product, ProductImageFile
from app.tenants.models import Tenant
from app.tests.test_product_image_cache_reads import (
    empty_thumbnail_cache as empty_thumbnail_cache,
)
from app.tests.test_product_image_cache_reads import (
    stored_image as stored_image,
)


@pytest.fixture
def db(owner_engine):
    # The optional writer deliberately owns another real connection. Commit
    # synthetic source rows so its RLS session can see them; savepoints cannot
    # verify this cross-connection contract.
    session = Session(owner_engine)
    tenant_ids = set()

    def track(_session, _context, _instances):
        tenant_ids.update(row.id for row in session.new if isinstance(row, Tenant) and row.id)

    event.listen(session, "before_flush", track)
    try:
        yield session
    finally:
        session.rollback()
        if tenant_ids:
            session.execute(delete(Tenant).where(Tenant.id.in_(tenant_ids)))
            session.commit()
        session.close()


@pytest.fixture(autouse=True)
def runtime_writer(monkeypatch, kova_app_engine):
    monkeypatch.setattr(images, "SessionLocal", sessionmaker(bind=kova_app_engine))


def clear_memory():
    with images._image_cache_lock:
        images._resized_images.clear()
        images._resized_image_bytes = 0


def variants(db, image_id):
    return db.execute(select(ProductImageFile.thumbnail_variants).where(
        ProductImageFile.id == image_id,
    )).scalar_one()


def test_runtime_persistence_survives_process_loss_without_blob_or_resize(db, stored_image, monkeypatch):
    first = images._load_product_image(stored_image.product_id, db, 160)
    entry = variants(db, stored_image.image_id)["160"]
    assert entry["source_sha256"] == hashlib.sha256(stored_image.first).hexdigest()
    assert base64.b64decode(entry["body_base64"], validate=True) == first.body
    assert db.execute(select(ProductImageFile.updated_at).where(
        ProductImageFile.id == stored_image.image_id,
    )).scalar_one() == stored_image.updated_at
    db.close()
    clear_memory()
    statements = []
    bind = db.get_bind()

    def capture(_conn, _cursor, statement, _params, _context, _many):
        if statement.lower().startswith("select "):
            statements.append(statement.lower())

    event.listen(bind, "before_cursor_execute", capture)
    monkeypatch.setattr(images, "_resize_to_width", MagicMock(side_effect=AssertionError("Unexpected decode")))
    try:
        cached = images._load_product_image(stored_image.product_id, db, 160)
    finally:
        event.remove(bind, "before_cursor_execute", capture)
    assert cached.body == first.body
    assert len(statements) == 1
    assert "select product_image_files.bytes_data" not in statements[0]
    assert "thumbnail_variants" in statements[0]
    assert "image-resize;dur=0.000" in cached.headers["server-timing"]


def test_widths_merge_and_original_fallback_is_not_persisted(db, stored_image):
    for width in (160, 320, 400, 800):
        images._load_product_image(stored_image.product_id, db, width)
    saved = variants(db, stored_image.image_id)
    assert set(saved) == {"160", "320", "400"}  # 800px returns the original.
    assert all(len(base64.b64decode(entry["body_base64"])) <= 128 * 1024 for entry in saved.values())


@pytest.mark.parametrize("corruption", ["digest", "mime", "source_mime", "base64", "extra", "oversize", "signature", "width"])
def test_invalid_persistence_uses_real_original(db, stored_image, corruption):
    first = images._load_product_image(stored_image.product_id, db, 160)
    entry = variants(db, stored_image.image_id)["160"]
    if corruption == "digest":
        entry["source_sha256"] = "0" * 64
    elif corruption == "mime":
        entry["content_type"] = "image/png"
    elif corruption == "source_mime":
        entry["source_content_type"] = "image/jpeg"
    elif corruption == "base64":
        entry["body_base64"] = "not valid base64!"
    elif corruption == "extra":
        entry["arbitrary_metadata"] = "synthetic"
    elif corruption == "signature":
        entry["body_base64"] = base64.b64encode(b"not-a-WebP" * 4).decode()
    elif corruption == "width":
        other = images._resize_to_width(stored_image.first, "image/png", 320)[0]
        entry["body_base64"] = base64.b64encode(other).decode()
    else:
        entry["body_base64"] = base64.b64encode(b"x" * (128 * 1024 + 1)).decode()
    db.execute(update(ProductImageFile).where(ProductImageFile.id == stored_image.image_id).values(
        thumbnail_variants={"160": entry}, updated_at=ProductImageFile.updated_at,
    ))
    db.commit()
    clear_memory()
    assert images._load_product_image(stored_image.product_id, db, 160).body == first.body
    saved = variants(db, stored_image.image_id)["160"]
    assert images._persisted_thumbnail(saved, hashlib.sha256(stored_image.first).digest(), "image/png", 160)


@pytest.mark.parametrize("change", ["replace", "deactivate", "delete"])
def test_deferred_write_cas_rejects_replaced_or_hidden_image(db, stored_image, change):
    tasks = BackgroundTasks()
    response = images._load_product_image(stored_image.product_id, db, 160, tasks)
    assert response.body and len(tasks.tasks) == 1
    assert variants(db, stored_image.image_id) is None
    if change == "replace":
        db.execute(update(ProductImageFile).where(ProductImageFile.id == stored_image.image_id).values(bytes_data=stored_image.second))
    elif change == "deactivate":
        db.execute(update(Product).where(Product.id == stored_image.product_id).values(is_active=False))
    else:
        db.delete(db.get(ProductImageFile, stored_image.image_id))
    db.commit()
    asyncio.run(tasks())
    if change != "delete":
        assert variants(db, stored_image.image_id) is None
    clear_memory()
    if change == "replace":
        assert images._load_product_image(stored_image.product_id, db, 160).body != response.body
    else:
        with pytest.raises(HTTPException) as error:
            images._load_product_image(stored_image.product_id, db, 160)
        assert error.value.status_code == 404


def test_writer_rls_rejects_foreign_tenant(db, stored_image):
    tasks = BackgroundTasks()
    images._load_product_image(stored_image.product_id, db, 160, tasks)
    image_id, _tenant, product_id, width, entry = tasks.tasks[0].args
    images._persist_thumbnail(image_id, uuid4(), product_id, width, entry)
    assert variants(db, stored_image.image_id) is None
    asyncio.run(tasks())
    assert "160" in variants(db, stored_image.image_id)


def test_busy_writer_opens_no_connection_and_memory_hit_retries(db, stored_image, monkeypatch):
    tasks = BackgroundTasks()
    first = images._load_product_image(stored_image.product_id, db, 160, tasks)
    factory = images.SessionLocal
    blocked = MagicMock(side_effect=AssertionError("Busy writer opened session"))
    monkeypatch.setattr(images, "SessionLocal", blocked)
    assert images._thumbnail_write_slots.acquire(blocking=False)
    try:
        asyncio.run(tasks())
    finally:
        images._thumbnail_write_slots.release()
    blocked.assert_not_called()
    assert variants(db, stored_image.image_id) is None
    monkeypatch.setattr(images, "SessionLocal", factory)
    assert images._load_product_image(stored_image.product_id, db, 160).body == first.body
    assert "160" in variants(db, stored_image.image_id)


def test_failed_write_rolls_back_closes_and_redacts(db, stored_image, monkeypatch, caplog):
    tasks = BackgroundTasks()
    result = images._load_product_image(stored_image.product_id, db, 160, tasks)
    session = MagicMock()
    session.execute.side_effect = RuntimeError("synthetic-private-failure")
    monkeypatch.setattr(images, "SessionLocal", lambda: session)
    asyncio.run(tasks())
    session.rollback.assert_called_once()
    session.close.assert_called_once()
    assert result.status_code == 200
    assert "product_thumbnail_cache_write_failed" in caplog.text
    assert "synthetic-private-failure" not in caplog.text
    assert images._thumbnail_write_slots.acquire(blocking=False)
    images._thumbnail_write_slots.release()

import hashlib
import json
import re
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog.models import Product, ProductImageFile
from app.db import set_tenant_context
from app.tenants.models import Tenant


def variant():
    return {
        "source_sha256": hashlib.sha256(b"original photo").hexdigest(),
        "source_content_type": "image/png", "content_type": "image/webp", "body_base64": "YQ==",
    }


@pytest.fixture
def image_row(db):
    tenant_id = uuid4()
    db.add(Tenant(id=tenant_id, name="Thumbnail bounds", slug=str(tenant_id)))
    db.flush()
    product = Product(tenant_id=tenant_id, name="Photo", price_amount=10)
    db.add(product)
    db.flush()
    image = ProductImageFile(
        tenant_id=tenant_id, product_id=product.id, content_type="image/png",
        bytes_data=b"original photo", byte_size=14,
    )
    db.add(image)
    db.flush()
    return image


def test_nullable_cache_uses_sql_null_and_accepts_only_existing_width_slots(db, image_row):
    assert db.execute(text(
        "SELECT thumbnail_variants IS NULL FROM product_image_files WHERE id=:id",
    ), {"id": image_row.id}).scalar_one()
    original = (image_row.bytes_data, image_row.updated_at, image_row.created_at)
    entries = {str(width): variant() for width in (160, 320, 400, 800)}
    # Cache writes explicitly preserve the existing original-image version.
    db.execute(text(
        "UPDATE product_image_files SET thumbnail_variants=cast(:value as jsonb) WHERE id=:id",
    ), {"id": image_row.id, "value": json.dumps(entries)})
    db.expire(image_row)
    assert image_row.thumbnail_variants == entries
    assert (image_row.bytes_data, image_row.updated_at, image_row.created_at) == original
    image_row.thumbnail_variants = None
    db.flush()
    assert db.execute(text(
        "SELECT thumbnail_variants IS NULL FROM product_image_files WHERE id=:id",
    ), {"id": image_row.id}).scalar_one()


@pytest.mark.parametrize("value", [
    "null", "[]", '"scalar"', "12", '{"640":{}}', '{"160":{},"extra":{}}',
    json.dumps({"160": {"body_base64": "a" * 1_048_576}}),
])
def test_database_rejects_unbounded_or_non_width_cache_documents(db, image_row, value):
    with pytest.raises(IntegrityError) as error, db.begin_nested():
        db.execute(text(
            "UPDATE product_image_files SET thumbnail_variants=cast(:value as jsonb) WHERE id=:id",
        ), {"id": image_row.id, "value": value})
    assert re.search(
        r"(?<![a-zA-Z0-9_])ck_product_image_thumbnail_variants(?![a-zA-Z0-9_])",
        str(error.value.orig),
    )


def test_existing_rls_allows_owner_cache_update_and_blocks_other_tenant(owner_engine, kova_app_engine):
    tenant_id, product_id, image_id = uuid4(), uuid4(), uuid4()
    values = {"tenant": tenant_id, "product": product_id, "image": image_id,
              "slug": str(tenant_id), "entry": json.dumps({"320": variant()})}
    try:
        with owner_engine.begin() as connection:
            connection.execute(text(
                "INSERT INTO tenants(id,name,slug) VALUES(:tenant,'Thumbnail RLS',:slug)",
            ), values)
            connection.execute(text(
                "INSERT INTO products(id,tenant_id,name,price_amount) "
                "VALUES(:product,:tenant,'Photo',10)",
            ), values)
            connection.execute(text(
                "INSERT INTO product_image_files(id,tenant_id,product_id,content_type,bytes_data,byte_size) "
                "VALUES(:image,:tenant,:product,'image/png',decode('61','hex'),1)",
            ), values)
        with Session(kova_app_engine) as session:
            set_tenant_context(session, tenant_id)
            result = session.execute(text(
                "UPDATE product_image_files SET thumbnail_variants=cast(:entry as jsonb) WHERE id=:image",
            ), values)
            assert result.rowcount == 1
            session.commit()
            set_tenant_context(session, uuid4())
            assert session.execute(text(
                "SELECT id FROM product_image_files WHERE id=:image",
            ), values).one_or_none() is None
            result = session.execute(text(
                "UPDATE product_image_files SET thumbnail_variants=NULL WHERE id=:image",
            ), values)
            assert result.rowcount == 0
            session.rollback()
        with owner_engine.connect() as connection:
            row = connection.execute(text(
                "SELECT thumbnail_variants,relrowsecurity,relforcerowsecurity "
                "FROM product_image_files JOIN pg_class ON pg_class.oid='product_image_files'::regclass "
                "WHERE product_image_files.id=:image",
            ), values).one()
            assert row == ({"320": variant()}, True, True)
    finally:
        with owner_engine.begin() as connection:
            connection.execute(text("DELETE FROM product_image_files WHERE id=:image"), values)
            connection.execute(text("DELETE FROM products WHERE id=:product"), values)
            connection.execute(text("DELETE FROM tenants WHERE id=:tenant"), values)

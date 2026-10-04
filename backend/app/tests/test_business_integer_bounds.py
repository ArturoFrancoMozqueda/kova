"""Persisted integer limits must fail as validation, never as database errors."""

from uuid import UUID, uuid4

import pytest

from app.audit.models import AuditLog
from app.catalog.models import Category, Product
from app.idempotency.models import IdempotencyKey
from app.orders.models import InventoryMovement

INTEGER_MIN = -(2**31)
INTEGER_MAX = 2**31 - 1


@pytest.fixture
def catalog(client):
    email = f"integer-bounds-{uuid4().hex}@example.com"
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": "Integer Bounds Bakery",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    owner = signup.json()
    assert (
        client.post(
            "/api/v1/auth/verify", json={"token": owner["dev_verification_token"]}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
        ).status_code
        == 200
    )
    category = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "bounds-category-create"},
        json={"name": "Pan", "sort_order": 3},
    )
    assert category.status_code == 201, category.text
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bounds-product-create"},
        json={
            "name": "Concha",
            "price_amount": "18.50",
            "track_inventory": True,
            "low_stock_threshold": 5,
        },
    )
    assert product.status_code == 201, product.text
    return {"owner": owner, "category": category.json(), "product": product.json()}


def _write_counts(db, tenant_id):
    return tuple(
        db.query(model).filter(model.tenant_id == tenant_id).count()
        for model in (Category, Product, InventoryMovement, AuditLog, IdempotencyKey)
    )


def _adjust(client, product_id, delta, key):
    return client.post(
        f"/api/v1/inventory/products/{product_id}/adjustments",
        headers={"Idempotency-Key": key},
        json={"quantity_delta": delta, "reason": "Conteo de apertura"},
    )


def _stock(client, product_id):
    response = client.get("/api/v1/inventory/stock")
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row["product_id"] == product_id)


def test_catalog_integer_overflow_rejected_without_writes(client, db, catalog):
    tenant_id = UUID(catalog["owner"]["tenant_id"])
    category_id = catalog["category"]["id"]
    product_id = catalog["product"]["id"]
    before = _write_counts(db, tenant_id)
    requests = (
        [
            ("post", "/api/v1/catalog/categories", {"name": "Invalid", "sort_order": value})
            for value in (INTEGER_MIN - 1, INTEGER_MAX + 1)
        ]
        + [
            ("patch", f"/api/v1/catalog/categories/{category_id}", {"sort_order": value})
            for value in (INTEGER_MIN - 1, INTEGER_MAX + 1)
        ]
        + [
            (
                "post",
                "/api/v1/catalog/products",
                {
                    "name": "Invalid",
                    "price_amount": "10.00",
                    "low_stock_threshold": INTEGER_MAX + 1,
                },
            ),
            (
                "patch",
                f"/api/v1/catalog/products/{product_id}",
                {"low_stock_threshold": INTEGER_MAX + 1},
            ),
            (
                "patch",
                f"/api/v1/inventory/products/{product_id}/low-stock-threshold",
                {"low_stock_threshold": INTEGER_MAX + 1},
            ),
        ]
    )
    for index, (method, url, body) in enumerate(requests):
        response = client.request(
            method, url, headers={"Idempotency-Key": f"invalid-int-{index}"}, json=body
        )
        assert response.status_code == 422, (url, body, response.text)
        field = "sort_order" if "sort_order" in body else "low_stock_threshold"
        assert any(error["loc"] == ["body", field] for error in response.json()["detail"])
    assert _write_counts(db, tenant_id) == before
    assert client.get("/api/v1/catalog/categories").json() == [catalog["category"]]
    assert client.get("/api/v1/catalog/products").json() == [catalog["product"]]


def test_inventory_integer_overflow_rejected_without_writes(client, db, catalog):
    tenant_id = UUID(catalog["owner"]["tenant_id"])
    product_id = catalog["product"]["id"]
    before = _write_counts(db, tenant_id)
    for index, delta in enumerate((INTEGER_MAX + 1, INTEGER_MIN - 1)):
        response = _adjust(client, product_id, delta, f"invalid-delta-{index}")
        assert response.status_code == 422, response.text
        assert any(
            error["loc"] == ["body", "quantity_delta"] for error in response.json()["detail"]
        )
    counted = client.post(
        f"/api/v1/inventory/products/{product_id}/stock-take",
        headers={"Idempotency-Key": "invalid-count"},
        json={"counted_quantity": INTEGER_MAX + 1, "reason": "Conteo"},
    )
    assert counted.status_code == 422, counted.text
    assert _write_counts(db, tenant_id) == before
    assert _stock(client, product_id)["stock_on_hand"] == 0


def test_cumulative_inventory_overflow_rejected_and_corrected_key_reusable(client, db, catalog):
    tenant_id = UUID(catalog["owner"]["tenant_id"])
    product_id = catalog["product"]["id"]
    opening = _adjust(client, product_id, INTEGER_MAX, "max-stock")
    assert opening.status_code == 201, opening.text
    before = _write_counts(db, tenant_id)

    overflow = _adjust(client, product_id, 1, "stock-overflow")
    assert overflow.status_code == 422, overflow.text
    assert overflow.json()["detail"]["code"] == "STOCK_LIMIT_EXCEEDED"
    # Production closes the failed request's session and rolls back the key
    # reservation. The shared transactional test session needs that explicitly.
    db.rollback()
    assert _write_counts(db, tenant_id) == before
    assert _stock(client, product_id)["stock_on_hand"] == INTEGER_MAX

    corrected = _adjust(client, product_id, -INTEGER_MAX, "stock-overflow")
    assert corrected.status_code == 201, corrected.text
    assert corrected.json()["stock_on_hand"] == 0
    replay = _adjust(client, product_id, -INTEGER_MAX, "stock-overflow")
    assert replay.status_code == 201, replay.text
    assert replay.json() == corrected.json()


def test_stock_take_validates_calculated_delta_for_legacy_large_stock(client, db, catalog):
    owner = catalog["owner"]
    tenant_id = UUID(owner["tenant_id"])
    product_id = catalog["product"]["id"]
    # Legacy movements can have no snapshot; each stored delta fits INTEGER
    # while their aggregate and the correction needed to reach zero do not.
    for _ in range(2):
        db.add(
            InventoryMovement(
                tenant_id=tenant_id,
                product_id=UUID(product_id),
                movement_type="adjustment",
                quantity_delta=INTEGER_MAX,
                stock_on_hand_after=None,
                reason="Legacy stock",
                created_by_user_id=UUID(owner["user_id"]),
            )
        )
    db.commit()
    before = _write_counts(db, tenant_id)
    url = f"/api/v1/inventory/products/{product_id}/stock-take"
    rejected = client.post(
        url,
        headers={"Idempotency-Key": "legacy-stock-take"},
        json={"counted_quantity": 0, "reason": "Corrección"},
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["detail"]["code"] == "QUANTITY_LIMIT_EXCEEDED"
    db.rollback()  # Mirror rollback on production request session close.
    assert _write_counts(db, tenant_id) == before
    assert _stock(client, product_id)["stock_on_hand"] == 2 * INTEGER_MAX

    corrected = client.post(
        url,
        headers={"Idempotency-Key": "legacy-stock-take"},
        json={"counted_quantity": INTEGER_MAX, "reason": "Corrección"},
    )
    assert corrected.status_code == 201, corrected.text
    assert corrected.json()["stock_on_hand"] == INTEGER_MAX


def test_catalog_import_integer_overflow_reported_before_commit(client, db, catalog):
    tenant_id = UUID(catalog["owner"]["tenant_id"])
    before = _write_counts(db, tenant_id)
    for field in ("stock_inicial", "umbral_stock"):
        content = (
            f"nombre,precio,control_inventario,{field}\n"
            f"Import overflow,10.00,sí,{INTEGER_MAX + 1}\n"
        ).encode()
        preview = client.post(
            "/api/v1/catalog/import?dry_run=true",
            content=content,
            headers={"Content-Type": "text/csv"},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["error_rows"] == 1
        assert any(field in error for error in preview.json()["rows"][0]["errors"])
        committed = client.post(
            "/api/v1/catalog/import?dry_run=false",
            content=content,
            headers={"Content-Type": "text/csv", "Idempotency-Key": f"overflow-import-{field}"},
        )
        assert committed.status_code == 400, committed.text
        db.rollback()  # Mirror rollback on production request session close.
        assert _write_counts(db, tenant_id) == before


def test_integer_boundaries_and_nullable_thresholds_remain_supported(client, catalog):
    category = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "min-category"},
        json={"name": "Boundary category", "sort_order": INTEGER_MIN},
    )
    assert category.status_code == 201, category.text
    update = client.patch(
        f"/api/v1/catalog/categories/{category.json()['id']}",
        headers={"Idempotency-Key": "max-category"},
        json={"sort_order": INTEGER_MAX},
    )
    assert update.status_code == 200, update.text
    assert update.json()["sort_order"] == INTEGER_MAX
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "max-threshold-product"},
        json={
            "name": "Boundary product",
            "price_amount": "10.00",
            "track_inventory": True,
            "low_stock_threshold": INTEGER_MAX,
        },
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]
    for suffix in ("", "/low-stock-threshold"):
        prefix = "catalog" if not suffix else "inventory"
        for index, threshold in enumerate((INTEGER_MAX, None)):
            response = client.patch(
                f"/api/v1/{prefix}/products/{product_id}{suffix}",
                headers={"Idempotency-Key": f"boundary-threshold-{prefix}-{index}"},
                json={"low_stock_threshold": threshold},
            )
            assert response.status_code == 200, response.text
            assert response.json()["low_stock_threshold"] == threshold
    for index in range(2):
        counted = client.post(
            f"/api/v1/inventory/products/{product_id}/stock-take",
            headers={"Idempotency-Key": f"max-stock-take-{index}"},
            json={"counted_quantity": INTEGER_MAX, "reason": "Conteo"},
        )
        assert counted.status_code == 201, counted.text
        assert counted.json()["stock_on_hand"] == INTEGER_MAX
        assert counted.json()["quantity_delta"] == (INTEGER_MAX if index == 0 else 0)


def test_minimum_delta_can_correct_legacy_stock_to_zero(client, db, catalog):
    owner = catalog["owner"]
    product_id = catalog["product"]["id"]
    for delta in (INTEGER_MAX, 1):
        db.add(
            InventoryMovement(
                tenant_id=UUID(owner["tenant_id"]),
                product_id=UUID(product_id),
                movement_type="adjustment",
                quantity_delta=delta,
                stock_on_hand_after=None,
                reason="Legacy stock",
                created_by_user_id=UUID(owner["user_id"]),
            )
        )
    db.commit()
    corrected = _adjust(client, product_id, INTEGER_MIN, "minimum-valid-delta")
    assert corrected.status_code == 201, corrected.text
    assert corrected.json()["stock_on_hand"] == 0

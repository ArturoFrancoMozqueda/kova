from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.audit.models import AuditLog
from app.auth.models import Membership

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")

# A real 1x1 PNG. Uploads are now signature-validated (the declared content-type
# must match the actual file bytes), so placeholder byte strings no longer pass.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return signup


def test_owner_creates_category_and_product_with_audit_logs(client, db):
    signup = _signup_verify_login(client, "catalog-test@example.com", "Catalog Test")

    category = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-create-1"},
        json={"name": "Pan dulce", "description": "Sweet breads"},
    )
    assert category.status_code == 201, category.text

    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "product-create-1"},
        json={
            "name": "Concha",
            "sku": "CONCHA-001",
            "price_amount": "18.50",
            "category_id": category.json()["id"],
        },
    )
    assert product.status_code == 201, product.text
    assert product.json()["price_amount"] == "18.50"

    actions = {
        row.action
        for row in db.query(AuditLog)
        .filter(AuditLog.tenant_id == UUID(signup["tenant_id"]))
        .all()
    }
    assert "catalog.category.create" in actions
    assert "catalog.product.create" in actions


def test_category_update_rejects_null_required_fields_and_allows_description_clear(client, db):
    signup = _signup_verify_login(client, "category-null@example.com", "Category Null Test")
    created = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-null-create"},
        json={"name": "Pan", "description": "Pan dulce", "sort_order": 3},
    )
    assert created.status_code == 201, created.text
    category = created.json()
    url = f"/api/v1/catalog/categories/{category['id']}"

    for field in ("name", "sort_order", "is_active"):
        rejected = client.patch(
            url,
            headers={"Idempotency-Key": "category-null-update"},
            json={field: None, "description": None},
        )
        assert rejected.status_code == 422, (field, rejected.text)
        assert any(error["loc"] == ["body", field] for error in rejected.json()["detail"])

    assert client.get("/api/v1/catalog/categories").json() == [category]
    assert db.query(AuditLog).filter(
        AuditLog.tenant_id == UUID(signup["tenant_id"]),
        AuditLog.action == "catalog.category.update",
    ).count() == 0

    # Validation must not consume the idempotency key; the corrected request
    # can clear a nullable field while omitted required fields retain values.
    cleared = client.patch(
        url,
        headers={"Idempotency-Key": "category-null-update"},
        json={"description": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json() == {**category, "description": None}


def test_product_update_rejects_null_required_fields_and_allows_nullable_clears(client, db):
    signup = _signup_verify_login(client, "product-null@example.com", "Product Null Test")
    created = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "product-null-create"},
        json={
            "name": "Concha",
            "description": "Vainilla",
            "price_amount": "18.50",
            "cost_price": "7.25",
            "track_inventory": True,
            "low_stock_threshold": 5,
        },
    )
    assert created.status_code == 201, created.text
    product = created.json()
    url = f"/api/v1/catalog/products/{product['id']}"

    for field in (
        "name", "price_amount", "track_inventory", "image_position_x",
        "image_position_y", "image_zoom", "is_active",
    ):
        rejected = client.patch(
            url,
            headers={"Idempotency-Key": "product-null-update"},
            json={field: None, "description": None},
        )
        assert rejected.status_code == 422, (field, rejected.text)
        assert any(error["loc"] == ["body", field] for error in rejected.json()["detail"])

    assert client.get("/api/v1/catalog/products").json() == [product]
    assert db.query(AuditLog).filter(
        AuditLog.tenant_id == UUID(signup["tenant_id"]),
        AuditLog.action == "catalog.product.update",
    ).count() == 0

    clears = {
        "description": None, "cost_price": None,
        "low_stock_threshold": None, "category_id": None,
    }
    cleared = client.patch(
        url,
        headers={"Idempotency-Key": "product-null-update"},
        json=clears,
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json() == {**product, **clears}


def test_catalog_create_requires_idempotency_key(client):
    _signup_verify_login(client, "catalog-no-key@example.com", "No Key Bakery")

    response = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Missing Key"},
    )

    assert response.status_code == 400


def test_category_create_idempotency_replays_same_response(client):
    _signup_verify_login(client, "catalog-idempotent@example.com", "Idempotent Bakery")
    payload = {"name": "Idempotent Category"}

    first = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-idempotency"},
        json=payload,
    )
    second = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-idempotency"},
        json=payload,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json() == first.json()


def test_idempotency_key_reuse_with_different_body_returns_400(client):
    _signup_verify_login(client, "catalog-idempotent-bad@example.com", "Bad Replay Bakery")

    first = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-idempotency-conflict"},
        json={"name": "Original"},
    )
    second = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "category-idempotency-conflict"},
        json={"name": "Different"},
    )

    assert first.status_code == 201
    assert second.status_code == 400


def test_cashier_cannot_create_catalog_category(client, db):
    signup = _signup_verify_login(client, "catalog-cashier-test@example.com", "Cashier Test")
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "catalog-cashier-test@example.com", "password": "S3cur3pass!"},
    )

    response = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "cashier-category"},
        json={"name": "Should Fail"},
    )

    assert response.status_code == 403


def test_product_price_uses_decimal_response(client):
    _signup_verify_login(client, "catalog-decimal@example.com", "Decimal Bakery")

    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "decimal-product"},
        json={"name": "Decimal Product", "price_amount": "12.30"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["price_amount"] == "12.30"
    assert Decimal(response.json()["price_amount"]) == Decimal("12.30")


def test_product_cost_create_update_clear_and_audit(client, db):
    signup = _signup_verify_login(client, "catalog-cost@example.com", "Cost Bakery")

    create = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "cost-product-create"},
        json={"name": "Costed Product", "price_amount": "25.00", "cost_price": "10.40"},
    )

    assert create.status_code == 201, create.text
    product = create.json()
    assert product["cost_price"] == "10.40"

    update = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "cost-product-update"},
        json={"cost_price": "11.25"},
    )
    assert update.status_code == 200, update.text
    assert update.json()["cost_price"] == "11.25"

    clear = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "cost-product-clear"},
        json={"cost_price": None},
    )
    assert clear.status_code == 200, clear.text
    assert clear.json()["cost_price"] is None

    rejected = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "cost-product-negative"},
        json={"cost_price": "-0.01"},
    )
    assert rejected.status_code == 422

    cost_audits = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "catalog.product.update",
        )
        .all()
    )
    assert [audit.changes["cost_price"] for audit in cost_audits] == ["11.25", None]


def test_product_cost_is_masked_for_cashier_catalog_reads(client, db):
    signup = _signup_verify_login(client, "catalog-cost-mask@example.com", "Cost Mask Bakery")
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "cost-mask-product"},
        json={"name": "Secret Cost", "price_amount": "25.00", "cost_price": "10.40"},
    ).json()
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": "catalog-cost-mask@example.com", "password": "S3cur3pass!"},
    )

    listed = client.get("/api/v1/catalog/products")

    assert listed.status_code == 200, listed.text
    [masked] = [item for item in listed.json() if item["id"] == product["id"]]
    assert masked["cost_price"] is None


def test_product_image_upload_and_get_returns_stored_bytes(client):
    _signup_verify_login(client, "catalog-image-get@example.com", "Image Get Bakery")
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "image-get-product"},
        json={"name": "Oreja", "price_amount": "20.00"},
    ).json()

    upload = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("oreja.png", PNG_BYTES, "image/png")},
    )

    assert upload.status_code == 200, upload.text
    image = client.get(upload.json()["image_url"])
    assert image.status_code == 200, image.text
    assert image.headers["content-type"].startswith("image/png")
    assert image.content == PNG_BYTES


def test_product_image_upload_does_not_reload_product_after_commit(client, db):
    _signup_verify_login(client, "catalog-image-commit@example.com", "Image Commit Bakery")
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "image-commit-product"},
        json={"name": "Latte helado", "price_amount": "55.00"},
    ).json()

    committed = False
    product_selects_after_commit: list[str] = []

    def mark_commit(_session):
        nonlocal committed
        committed = True

    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        if committed and "FROM products" in statement:
            product_selects_after_commit.append(statement)

    event.listen(db, "after_commit", mark_commit)
    event.listen(db.bind, "before_cursor_execute", record_sql)
    try:
        upload = client.post(
            f"/api/v1/catalog/products/{product['id']}/image",
            files={"file": ("latte.png", PNG_BYTES, "image/png")},
        )
    finally:
        event.remove(db, "after_commit", mark_commit)
        event.remove(db.bind, "before_cursor_execute", record_sql)

    assert upload.status_code == 200, upload.text
    assert upload.json()["image_url"].startswith(
        f"/api/v1/catalog/products/{product['id']}/image?v="
    )
    assert product_selects_after_commit == []


def test_product_image_get_hides_deactivated_products(client):
    _signup_verify_login(client, "catalog-image-inactive@example.com", "Inactive Image Bakery")
    product = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "image-inactive-product"},
        json={"name": "Polvoron", "price_amount": "15.00"},
    ).json()
    upload = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("polvoron.png", PNG_BYTES, "image/png")},
    )
    assert upload.status_code == 200, upload.text

    deactivate = client.delete(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "image-inactive-deactivate"},
    )

    assert deactivate.status_code == 200, deactivate.text
    image = client.get(upload.json()["image_url"])
    assert image.status_code == 404


def test_product_image_position_defaults_and_updates(client):
    _signup_verify_login(client, "catalog-image-position@example.com", "Image Position Bakery")

    create = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "image-position-defaults"},
        json={"name": "Alfajor", "price_amount": "32.00"},
    )

    assert create.status_code == 201, create.text
    product = create.json()
    assert product["image_position_x"] == 50
    assert product["image_position_y"] == 50

    update = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        headers={"Idempotency-Key": "image-position-update"},
        json={"image_position_x": 35, "image_position_y": 70},
    )

    assert update.status_code == 200, update.text
    assert update.json()["image_position_x"] == 35
    assert update.json()["image_position_y"] == 70

    listed = client.get("/api/v1/catalog/products")
    assert listed.status_code == 200, listed.text
    [listed_product] = [
        item for item in listed.json() if item["id"] == product["id"]
    ]
    assert listed_product["image_position_x"] == 35
    assert listed_product["image_position_y"] == 70


def test_product_image_position_rejects_out_of_range_values(client):
    _signup_verify_login(client, "catalog-image-position-invalid@example.com", "Invalid Image Position")

    create = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "image-position-invalid-create"},
        json={"name": "Bad Position", "price_amount": "32.00", "image_position_x": 101},
    )

    assert create.status_code == 422

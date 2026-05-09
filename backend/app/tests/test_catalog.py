from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient

from app.audit.models import AuditLog
from app.auth.models import Membership


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
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

"""Adversarial input-validation tests.

Covers the hardening added in the input-validation pass: strict request schemas
(unknown fields rejected), collection-size caps, the global body-size limit,
upload signature validation, injection payloads stored safely, malformed
path/body handling, and cross-tenant resource references.
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.middleware.body_size import MAX_REQUEST_BYTES
from app.orders.schemas import OrderCreate
from app.shared.validation import (
    MAX_OFFLINE_SALES_BATCH,
    MAX_ORDER_ITEMS,
    verify_image_signature,
)
from app.sync.schemas import OfflineSaleSyncItem

# Real 1x1 PNG — signature checks require the bytes to match the declared type.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
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


def _create_product(client: TestClient, key: str, **overrides) -> dict:
    payload = {"name": "Producto", "price_amount": "10.00", **overrides}
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": key},
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- Unknown / unexpected fields -------------------------------------------------


def test_unknown_field_on_strict_signup_is_rejected(client):
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "extra-field@example.com",
            "password": "S3cur3pass!",
            "tenant_name": "Extra Field Bakery",
            "accepted_terms": True,
            "role": "owner",  # not a real field — attempted mass assignment
        },
    )
    assert response.status_code == 422, response.text


def test_unknown_field_on_strict_category_is_rejected(client):
    _signup_verify_login(client, "extra-category@example.com", "Extra Category Bakery")
    response = client.post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "extra-category"},
        json={"name": "Pan", "tenant_id": str(uuid4())},  # tenant_id is server-derived
    )
    assert response.status_code == 422, response.text


def test_order_schema_stays_lenient_for_offline_compat():
    """OrderCreate / offline-sync intentionally ignore unknown fields so older
    queued offline sales keep replaying. Unknown fields must NOT raise."""
    order = OrderCreate.model_validate(
        {
            "items": [{"product_id": str(uuid4()), "quantity": 1}],
            "payments": [{"method": "cash", "amount": "10.00"}],
            "legacy_field_from_old_bundle": "ignored",
        }
    )
    assert order.items[0].quantity == 1

    item = OfflineSaleSyncItem.model_validate(
        {
            "client_uuid": str(uuid4()),
            "order": {
                "items": [{"product_id": str(uuid4()), "quantity": 1}],
                "payments": [{"method": "cash", "amount": "10.00"}],
            },
            "obsolete_field": True,
        }
    )
    assert item.order.payments[0].amount == Decimal("10.00")


# --- Collection-size caps --------------------------------------------------------


def test_order_items_over_cap_rejected():
    item = {"product_id": str(uuid4()), "quantity": 1}
    with pytest.raises(ValidationError):
        OrderCreate.model_validate(
            {
                "items": [item] * (MAX_ORDER_ITEMS + 1),
                "payments": [{"method": "cash", "amount": "1.00"}],
            }
        )


def test_order_items_at_cap_accepted():
    item = {"product_id": str(uuid4()), "quantity": 1}
    order = OrderCreate.model_validate(
        {
            "items": [item] * MAX_ORDER_ITEMS,
            "payments": [{"method": "cash", "amount": "1.00"}],
        }
    )
    assert len(order.items) == MAX_ORDER_ITEMS


def test_offline_sales_batch_over_cap_rejected(client):
    _signup_verify_login(client, "offline-cap@example.com", "Offline Cap Bakery")
    one_sale = {
        "client_uuid": str(uuid4()),
        "order": {
            "items": [{"product_id": str(uuid4()), "quantity": 1}],
            "payments": [{"method": "cash", "amount": "1.00"}],
        },
    }
    response = client.post(
        "/api/v1/sync/offline-sales",
        json={"sales": [one_sale] * (MAX_OFFLINE_SALES_BATCH + 1)},
    )
    assert response.status_code == 422, response.text


# --- Global body-size limit ------------------------------------------------------


def test_oversized_body_rejected_with_413(client):
    oversized = b"x" * (MAX_REQUEST_BYTES + 1)
    response = client.post(
        "/api/v1/auth/login",
        content=oversized,
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413, response.text


def test_normal_body_not_blocked_by_size_limit(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever123"},
    )
    # 401 (bad creds) proves the request passed the size gate and reached auth.
    assert response.status_code == 401, response.text


# --- Upload signature validation -------------------------------------------------


def test_image_signature_helper_accepts_and_rejects():
    verify_image_signature("image/png", PNG_BYTES)  # no raise
    with pytest.raises(HTTPException):
        verify_image_signature("image/png", b"\xff\xd8\xffnot-a-png")
    with pytest.raises(HTTPException):
        verify_image_signature("image/png", b"plain text claiming png")


def test_product_image_mime_spoof_rejected(client):
    _signup_verify_login(client, "spoof-upload@example.com", "Spoof Bakery")
    product = _create_product(client, "spoof-product")
    response = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("evil.png", b"<svg onload=alert(1)>", "image/png")},
    )
    assert response.status_code == 400, response.text


def test_product_image_valid_png_accepted(client):
    _signup_verify_login(client, "valid-upload@example.com", "Valid Upload Bakery")
    product = _create_product(client, "valid-product")
    response = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        files={"file": ("ok.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 200, response.text


def test_product_image_malformed_multipart_rejected(client):
    _signup_verify_login(client, "malformed-upload@example.com", "Malformed Bakery")
    product = _create_product(client, "malformed-product")
    response = client.post(
        f"/api/v1/catalog/products/{product['id']}/image",
        content=b"garbage-not-multipart",
        headers={"content-type": "multipart/form-data; boundary=zzz"},
    )
    assert response.status_code == 400, response.text


# --- Injection payloads stored safely --------------------------------------------


def test_sql_injection_in_product_name_is_stored_literally(client):
    _signup_verify_login(client, "sqli@example.com", "SQLi Bakery")
    payload = "Robert'); DROP TABLE products;--"
    product = _create_product(client, "sqli-product", name=payload)
    assert product["name"] == payload  # stored verbatim, not executed
    # The table still exists and is queryable.
    listed = client.get("/api/v1/catalog/products")
    assert listed.status_code == 200
    assert any(p["name"] == payload for p in listed.json())


def test_html_in_product_name_is_rejected(client):
    _signup_verify_login(client, "xss-name@example.com", "XSS Name Bakery")
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "xss-name"},
        json={"name": "<script>alert(1)</script>", "price_amount": "5.00"},
    )
    assert response.status_code == 422, response.text


def test_xss_in_description_is_stored_verbatim_and_json_safe(client):
    _signup_verify_login(client, "xss-desc@example.com", "XSS Desc Bakery")
    payload = '<img src=x onerror="alert(1)">'
    product = _create_product(client, "xss-desc", description=payload)
    # Round-trips literally; JSON encoding (and React on render) handle escaping.
    assert product["description"] == payload


# --- Malformed path / body -------------------------------------------------------


def test_malformed_uuid_path_param_rejected(client):
    _signup_verify_login(client, "bad-uuid@example.com", "Bad UUID Bakery")
    response = client.get("/api/v1/orders/not-a-uuid")
    assert response.status_code == 422, response.text


def test_path_traversal_in_uuid_param_rejected(client):
    _signup_verify_login(client, "traversal@example.com", "Traversal Bakery")
    response = client.get("/api/v1/catalog/products/..%2f..%2f..%2fetc%2fpasswd/image")
    assert response.status_code in (404, 422), response.text


def test_malformed_json_body_rejected(client):
    response = client.post(
        "/api/v1/auth/login",
        content=b"{not valid json",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422, response.text


# --- Cross-tenant resource references --------------------------------------------


def test_cross_tenant_product_update_is_not_found(client):
    _signup_verify_login(client, "tenant-a@example.com", "Tenant A Bakery")
    product_a = _create_product(client, "tenant-a-product")
    client.post("/api/v1/auth/logout")

    _signup_verify_login(client, "tenant-b@example.com", "Tenant B Bakery")
    response = client.patch(
        f"/api/v1/catalog/products/{product_a['id']}",
        headers={"Idempotency-Key": "cross-tenant-patch"},
        json={"name": "Hijacked"},
    )
    assert response.status_code == 404, response.text


def test_cross_tenant_order_access_is_not_found(client):
    # Orders enforce ownership the same way; a random/other-tenant id is 404.
    _signup_verify_login(client, "order-tenant@example.com", "Order Tenant Bakery")
    response = client.get(f"/api/v1/orders/{uuid4()}")
    assert response.status_code == 404, response.text

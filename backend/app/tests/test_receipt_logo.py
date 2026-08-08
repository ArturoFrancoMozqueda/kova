from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.business_settings.models import ReceiptSettings, TenantLogoFile

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


def _upload_logo(client: TestClient, content: bytes = PNG_BYTES, content_type: str = "image/png"):
    return client.post(
        "/api/v1/settings/receipt/logo",
        files={"file": ("logo.png", content, content_type)},
    )


def test_receipt_logo_upload_stores_file_and_updates_settings(client, db):
    signup = _signup_verify_login(client, "logo-upload@example.com", "Logo Upload Bakery")

    response = _upload_logo(client)

    assert response.status_code == 200, response.text
    logo_url = response.json()["logo_url"]
    assert logo_url.startswith(f"/api/v1/settings/receipt/logo/{signup['tenant_id']}?v=")

    tenant_id = UUID(signup["tenant_id"])
    logo = db.query(TenantLogoFile).filter(TenantLogoFile.tenant_id == tenant_id).one()
    assert logo.content_type == "image/png"
    assert logo.bytes_data == PNG_BYTES
    settings = db.get(ReceiptSettings, tenant_id)
    assert settings.logo_url == logo_url


def test_receipt_logo_upload_does_not_reload_settings_after_commit(client, db):
    _signup_verify_login(client, "logo-commit@example.com", "Logo Commit Bakery")
    committed = False
    settings_selects_after_commit: list[str] = []

    def mark_commit(_session):
        nonlocal committed
        committed = True

    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        if committed and "FROM tenant_receipt_settings" in statement:
            settings_selects_after_commit.append(statement)

    event.listen(db, "after_commit", mark_commit)
    event.listen(db.bind, "before_cursor_execute", record_sql)
    try:
        response = _upload_logo(client)
    finally:
        event.remove(db, "after_commit", mark_commit)
        event.remove(db.bind, "before_cursor_execute", record_sql)

    assert response.status_code == 200, response.text
    assert response.json()["logo_url"].startswith("/api/v1/settings/receipt/logo/")
    assert settings_selects_after_commit == []


def test_receipt_logo_upload_rejects_large_file(client):
    _signup_verify_login(client, "logo-large@example.com", "Large Logo Bakery")

    response = _upload_logo(client, b"x" * (512 * 1024 + 1), "image/png")

    assert response.status_code == 400
    assert "512 KB" in response.text


def test_receipt_logo_upload_rejects_unsupported_content_type(client):
    _signup_verify_login(client, "logo-type@example.com", "Type Logo Bakery")

    response = _upload_logo(client, b"not an image", "text/plain")

    assert response.status_code == 400
    assert "PNG" in response.text


def test_receipt_logo_upload_rejects_svg(client):
    """SVG is rejected: it can carry embedded script (XSS on the logo render
    surface). Raster formats only."""
    _signup_verify_login(client, "logo-svg@example.com", "SVG Logo Bakery")

    response = _upload_logo(
        client,
        b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        "image/svg+xml",
    )

    assert response.status_code == 400
    assert "PNG" in response.text


def test_receipt_logo_upload_is_bound_to_current_tenant(client, db):
    # Uploads are signature-validated now, so both tenants send a real PNG.
    # Isolation is proven by each tenant owning its own logo row.
    tenant_a = _signup_verify_login(client, "logo-a@example.com", "Logo Tenant A")
    upload_a = _upload_logo(client, PNG_BYTES, "image/png")
    assert upload_a.status_code == 200, upload_a.text
    client.post("/api/v1/auth/logout")

    tenant_b = _signup_verify_login(client, "logo-b@example.com", "Logo Tenant B")
    upload_b = _upload_logo(client, PNG_BYTES, "image/png")
    assert upload_b.status_code == 200, upload_b.text

    logo_a = db.query(TenantLogoFile).filter(TenantLogoFile.tenant_id == UUID(tenant_a["tenant_id"])).one()
    logo_b = db.query(TenantLogoFile).filter(TenantLogoFile.tenant_id == UUID(tenant_b["tenant_id"])).one()
    assert logo_a.tenant_id != logo_b.tenant_id
    assert logo_a.bytes_data == PNG_BYTES
    assert logo_b.bytes_data == PNG_BYTES


def test_receipt_logo_public_get_returns_bytes(client):
    signup = _signup_verify_login(client, "logo-public@example.com", "Public Logo Bakery")
    upload = _upload_logo(client)
    assert upload.status_code == 200, upload.text
    client.post("/api/v1/auth/logout")

    response = client.get(f"/api/v1/settings/receipt/logo/{signup['tenant_id']}")

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["cache-control"] == "public, max-age=86400"


def test_receipt_logo_delete_removes_file_and_clears_settings(client, db):
    signup = _signup_verify_login(client, "logo-delete@example.com", "Delete Logo Bakery")
    upload = _upload_logo(client)
    assert upload.status_code == 200, upload.text

    response = client.delete("/api/v1/settings/receipt/logo")

    assert response.status_code == 204
    tenant_id = UUID(signup["tenant_id"])
    assert db.query(TenantLogoFile).filter(TenantLogoFile.tenant_id == tenant_id).one_or_none() is None
    assert db.get(ReceiptSettings, tenant_id).logo_url is None

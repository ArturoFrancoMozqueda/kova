import io
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.account_lifecycle.models import AccountDeletionRequest
from app.account_lifecycle.service import purge_due_accounts
from app.auth.models import Membership, User
from app.tenants.models import Tenant


def _signup_login(client: TestClient, email: str, tenant_name: str) -> dict:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
    )
    token = signup.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    login = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
    )
    assert login.status_code == 200, login.text
    return signup.json()


def test_owner_exports_tenant_data_as_zip(client: TestClient) -> None:
    signup = _signup_login(client, "export-owner@example.com", "Panadería Exportable")
    product = client.post(
        "/api/v1/catalog/products",
        json={"name": "Concha", "price_amount": "18.00", "sku": "CON-1"},
        headers={"Idempotency-Key": "export-product"},
    )
    assert product.status_code == 201, product.text
    formula_product = client.post(
        "/api/v1/catalog/products",
        json={"name": "=2+2", "price_amount": "1.00", "sku": "SAFE-CSV"},
        headers={"Idempotency-Key": "export-formula-product"},
    )
    assert formula_product.status_code == 201, formula_product.text

    response = client.get("/api/v1/export/account")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "kova-export-" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "manifest.json" in names
        assert "datos/products.csv" in names
        assert "datos/miembros.csv" in names
        assert "datos/sessions.csv" not in names
        products = archive.read("datos/products.csv").decode()
        assert "Concha" in products
        assert "'=2+2" in products
        assert signup["tenant_id"] in products
        assert "export-owner@example.com" in archive.read("datos/miembros.csv").decode()


def test_only_owner_can_export_or_schedule(client: TestClient, db: Session) -> None:
    signup = _signup_login(client, "manager-export@example.com", "Negocio Gerente")
    membership = db.scalar(
        select(Membership).where(Membership.tenant_id == signup["tenant_id"])
    )
    assert membership is not None
    membership.role = "manager"
    db.commit()

    assert client.get("/api/v1/export/account").status_code == 403
    response = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Negocio Gerente"},
    )
    assert response.status_code == 403


def test_deletion_requires_reauthentication_and_exact_name(client: TestClient) -> None:
    _signup_login(client, "delete-confirm@example.com", "Café Confirmado")

    wrong_password = client.post(
        "/api/v1/account/deletion",
        json={"password": "incorrecta", "tenant_name": "Café Confirmado"},
    )
    assert wrong_password.status_code == 401
    wrong_name = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Otro negocio"},
    )
    assert wrong_name.status_code == 400


def test_owner_schedules_and_cancels_deletion(client: TestClient) -> None:
    _signup_login(client, "delete-owner@example.com", "Tienda Reversible")

    scheduled = client.post(
        "/api/v1/account/deletion",
        json={"password": "S3cur3pass!", "tenant_name": "Tienda Reversible"},
    )
    assert scheduled.status_code == 200, scheduled.text
    assert scheduled.json()["status"] == "pending"
    assert scheduled.json()["purge_after"]
    assert client.get("/api/v1/account/deletion").json()["status"] == "pending"

    canceled = client.delete("/api/v1/account/deletion")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"
    assert client.get("/api/v1/account/deletion").json()["status"] == "none"


def test_internal_purge_is_guarded(client: TestClient, monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "internal_api_key", "lifecycle-secret")
    assert client.post("/api/v1/account/internal/deletions/purge").status_code == 403
    response = client.post(
        "/api/v1/account/internal/deletions/purge",
        headers={"X-Internal-Key": "lifecycle-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"purged": 0}


def test_due_purge_removes_only_requested_tenant(client: TestClient, db: Session) -> None:
    first = _signup_login(client, "purge-a@example.com", "Purge A")
    second_client = TestClient(client.app)
    second = _signup_login(second_client, "purge-b@example.com", "Purge B")
    first_user = db.scalar(select(User).where(User.email == "purge-a@example.com"))
    assert first_user is not None
    db.add(
        AccountDeletionRequest(
            id=uuid4(),
            tenant_id=first["tenant_id"],
            requested_by_user_id=first_user.id,
            purge_after=datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    db.commit()

    assert purge_due_accounts(db) == 1
    assert db.get(Tenant, first["tenant_id"]) is None
    assert db.scalar(select(User).where(User.email == "purge-a@example.com")) is None
    assert db.get(Tenant, second["tenant_id"]) is not None
    tombstone = db.scalar(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.tenant_id == first["tenant_id"]
        )
    )
    assert tombstone is not None
    assert tombstone.status == "completed"
    assert tombstone.requested_by_user_id is None

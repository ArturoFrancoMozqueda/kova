from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.catalog.models import Category, Product

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_login(client: TestClient, *, email: str, tenant_name: str) -> dict:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
    )
    body = signup.json()
    assert client.post(
        "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    ).status_code == 200
    return body


def test_abarrotes_preset_is_explicit_tenant_scoped_and_has_no_invented_costs(
    client: TestClient, db: Session
) -> None:
    suffix = uuid4().hex
    tenant_a = _signup_login(
        client,
        email=f"abarrotes-a-{suffix}@example.com",
        tenant_name="Abarrotes A",
    )
    tenant_a_id = tenant_a["tenant_id"]
    assert list(db.scalars(select(Product).where(Product.tenant_id == tenant_a_id))) == []

    other_client = TestClient(client.app)
    tenant_b = _signup_login(
        other_client,
        email=f"abarrotes-b-{suffix}@example.com",
        tenant_name="Abarrotes B",
    )

    response = client.post(
        "/api/v1/onboarding/apply-preset", json={"preset": "abarrotes"}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "preset": "abarrotes",
        "categories_created": 4,
        "products_created": 16,
        "skipped": False,
    }
    products = list(
        db.scalars(select(Product).where(Product.tenant_id == tenant_a_id))
    )
    assert len(products) == 16
    assert all(product.cost_price is None for product in products)
    assert all(product.track_inventory for product in products)
    assert len({product.sku for product in products}) == 16
    assert db.scalar(
        select(Product).where(Product.tenant_id == tenant_b["tenant_id"])
    ) is None
    assert len(
        list(db.scalars(select(Category).where(Category.tenant_id == tenant_a_id)))
    ) == 4
    audit = db.scalar(
        select(AuditLog).where(
            AuditLog.tenant_id == tenant_a_id,
            AuditLog.action == "onboarding.preset.applied",
        )
    )
    assert audit is not None
    assert audit.changes["preset"] == "abarrotes"


def test_preset_does_not_overwrite_an_existing_catalog(client: TestClient) -> None:
    suffix = uuid4().hex
    _signup_login(
        client,
        email=f"abarrotes-existing-{suffix}@example.com",
        tenant_name="Abarrotes Existente",
    )
    first = client.post(
        "/api/v1/onboarding/apply-preset", json={"preset": "abarrotes"}
    )
    assert first.status_code == 200

    second = client.post(
        "/api/v1/onboarding/apply-preset", json={"preset": "abarrotes"}
    )
    assert second.status_code == 200
    assert second.json()["skipped"] is True
    assert second.json()["products_created"] == 0


def test_unknown_preset_is_rejected_before_file_access(client: TestClient) -> None:
    suffix = uuid4().hex
    _signup_login(
        client,
        email=f"preset-invalid-{suffix}@example.com",
        tenant_name="Preset Inválido",
    )
    response = client.post(
        "/api/v1/onboarding/apply-preset", json={"preset": "../../secrets"}
    )
    assert response.status_code == 422


def test_preset_preview_lists_the_real_starter_catalog_without_writing(
    client: TestClient, db: Session
) -> None:
    suffix = uuid4().hex
    account = _signup_login(
        client,
        email=f"preset-preview-{suffix}@example.com",
        tenant_name="Vista Previa",
    )

    response = client.get("/api/v1/onboarding/presets/cafe")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["preset"] == "cafe"
    assert body["label"] == "Cafetería"
    assert len(body["categories"]) == 4
    assert len(body["products"]) == 12
    assert body["products"][0] == {
        "name": "Americano chico",
        "category": "Café caliente",
        "price_amount": "38.00",
    }
    # Read-only: previewing never creates catalog rows or audit entries.
    tenant_id = account["tenant_id"]
    assert db.scalar(select(Product).where(Product.tenant_id == tenant_id)) is None
    assert db.scalar(
        select(AuditLog).where(
            AuditLog.tenant_id == tenant_id,
            AuditLog.action == "onboarding.preset.applied",
        )
    ) is None

    applied = client.post("/api/v1/onboarding/apply-preset", json={"preset": "cafe"})
    assert applied.json()["products_created"] == len(body["products"])


def test_preset_preview_requires_catalog_permission_and_a_known_preset(
    client: TestClient, db: Session
) -> None:
    assert TestClient(client.app).get("/api/v1/onboarding/presets/cafe").status_code == 401

    suffix = uuid4().hex
    account = _signup_login(
        client,
        email=f"preset-preview-rbac-{suffix}@example.com",
        tenant_name="Vista Previa RBAC",
    )
    assert client.get("/api/v1/onboarding/presets/..%2F..%2Fsecrets").status_code in {404, 422}
    assert client.get("/api/v1/onboarding/presets/unknown").status_code == 422

    member = db.query(Membership).filter_by(tenant_id=UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get("/api/v1/onboarding/presets/cafe").status_code == 403

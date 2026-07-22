from unittest.mock import MagicMock
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.main import app
from app.modifiers import service as modifier_service
from app.modifiers.models import ProductModifierGroup
from app.modifiers.schemas import SetProductModifierGroups


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


def _create_product(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": name, "price_amount": "10.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_modifier_group(client: TestClient, name: str) -> dict:
    response = client.post(
        "/api/v1/catalog/modifier-groups",
        headers={"Idempotency-Key": str(uuid4())},
        json={"name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_cross_tenant_product_modifier_assignment_is_rejected(client):
    suffix = uuid4().hex[:8]
    signup_a = _signup_verify_login(client, f"pmg-a-{suffix}@example.com", "Tenant A")
    product_a = _create_product(client, "Tenant A product")
    group_a = _create_modifier_group(client, "Tenant A group")

    with TestClient(app) as client_b:
        _signup_verify_login(client_b, f"pmg-b-{suffix}@example.com", "Tenant B")
        product_b = _create_product(client_b, "Tenant B product")

        guessed_product = client_b.get(
            f"/api/v1/catalog/products/{product_a['id']}/modifier-groups",
        )

    cross_assignment = client.put(
        f"/api/v1/catalog/products/{product_b['id']}/modifier-groups",
        json={"assignments": [{"modifier_group_id": group_a["id"]}]},
    )

    assert signup_a["tenant_id"] != product_b["tenant_id"]
    assert guessed_product.status_code == 404
    assert cross_assignment.status_code == 404


def test_blank_product_modifier_group_id_is_rejected(client):
    suffix = uuid4().hex[:8]
    _signup_verify_login(client, f"pmg-blank-{suffix}@example.com", "Tenant Blank")
    product = _create_product(client, "Product with blank modifier group")

    response = client.put(
        f"/api/v1/catalog/products/{product['id']}/modifier-groups",
        json={"assignments": [{"modifier_group_id": "", "sort_order": 0}]},
    )

    assert response.status_code == 422


def test_product_modifier_groups_are_read_before_transaction_commit(monkeypatch):
    db = MagicMock(spec=Session)
    tenant_id = uuid4()
    user_id = uuid4()
    product_id = uuid4()
    events: list[str] = []
    expected_response = []

    monkeypatch.setattr(modifier_service, "_get_product", lambda *args, **kwargs: object())
    monkeypatch.setattr(modifier_service.audit_service, "log", lambda *args, **kwargs: None)

    def read_groups(*args, **kwargs):
        events.append("read")
        return expected_response

    db.commit.side_effect = lambda: events.append("commit")
    monkeypatch.setattr(modifier_service, "get_product_modifier_groups", read_groups)

    response = modifier_service.set_product_modifier_groups(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        product_id=product_id,
        body=SetProductModifierGroups(assignments=[]),
    )

    db.flush.assert_called_once_with()
    assert events == ["read", "commit"]
    assert response is expected_response


def test_product_modifier_groups_have_tenant_scoped_foreign_keys(db):
    inspector = inspect(db.bind)

    expected = {
        "modifier_options": {
            "fk_modifier_options_tenant_group",
        },
        "product_modifier_groups": {
            "fk_product_modifier_groups_tenant_product",
            "fk_product_modifier_groups_tenant_group",
        },
        "order_item_modifiers": {
            "fk_order_item_modifiers_tenant_order_item",
            "fk_order_item_modifiers_tenant_group",
            "fk_order_item_modifiers_tenant_option",
        },
    }

    for table_name, constraint_names in expected.items():
        actual = {fk["name"] for fk in inspector.get_foreign_keys(table_name)}
        assert constraint_names.issubset(actual)


def test_database_rejects_cross_tenant_product_modifier_group_row(client, db):
    suffix = uuid4().hex[:8]
    signup_a = _signup_verify_login(client, f"pmg-db-a-{suffix}@example.com", "Tenant A")
    group_a = _create_modifier_group(client, "Tenant A db group")

    with TestClient(app) as client_b:
        _signup_verify_login(client_b, f"pmg-db-b-{suffix}@example.com", "Tenant B")
        product_b = _create_product(client_b, "Tenant B db product")

    db.add(
        ProductModifierGroup(
            tenant_id=UUID(signup_a["tenant_id"]),
            product_id=UUID(product_b["id"]),
            modifier_group_id=UUID(group_a["id"]),
            sort_order=0,
        )
    )

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
    else:
        raise AssertionError("Cross-tenant product modifier assignment was accepted")

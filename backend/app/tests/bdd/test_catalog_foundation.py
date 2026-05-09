from uuid import UUID

from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership
from app.main import app


@scenario(
    "../../../../specs/catalog/catalog_foundation.feature",
    "Tenant owner creates and lists a category and product",
)
def test_owner_creates_and_lists_catalog():
    pass


@scenario(
    "../../../../specs/catalog/catalog_foundation.feature",
    "Cashier cannot create catalog products",
)
def test_cashier_cannot_create_catalog_products():
    pass


@scenario(
    "../../../../specs/catalog/catalog_foundation.feature",
    "Tenants cannot see each other's catalog products",
)
def test_tenants_cannot_see_each_others_catalog_products():
    pass


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


@given("a verified tenant owner for catalog setup", target_fixture="catalog_context")
def verified_tenant_owner(client):
    signup = _signup_verify_login(client, "catalog-owner@example.com", "Catalog Bakery")
    return {"client": client, "signup": signup}


@when(parsers.parse('the owner creates a catalog category named "{category_name}"'))
def owner_creates_category(catalog_context, category_name):
    response = catalog_context["client"].post(
        "/api/v1/catalog/categories",
        headers={"Idempotency-Key": "bdd-category-create"},
        json={"name": category_name},
    )
    assert response.status_code == 201, response.text
    catalog_context["category"] = response.json()


@when(parsers.parse('creates a product named "{product_name}" priced at "{price}" in that category'))
def owner_creates_product(catalog_context, product_name, price):
    response = catalog_context["client"].post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bdd-product-create"},
        json={
            "name": product_name,
            "price_amount": price,
            "category_id": catalog_context["category"]["id"],
        },
    )
    assert response.status_code == 201, response.text
    catalog_context["product"] = response.json()


@then("the owner sees the category in their catalog")
def owner_sees_category(catalog_context):
    response = catalog_context["client"].get("/api/v1/catalog/categories")
    assert response.status_code == 200, response.text
    assert catalog_context["category"]["id"] in {item["id"] for item in response.json()}


@then("sees the product in their catalog")
def owner_sees_product(catalog_context):
    response = catalog_context["client"].get("/api/v1/catalog/products")
    assert response.status_code == 200, response.text
    assert catalog_context["product"]["id"] in {item["id"] for item in response.json()}


@given("a verified tenant cashier for catalog setup", target_fixture="cashier_context")
def verified_tenant_cashier(client, db):
    signup = _signup_verify_login(client, "catalog-cashier@example.com", "Cashier Bakery")
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
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "catalog-cashier@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client}


@when("the cashier tries to create a product")
def cashier_tries_to_create_product(cashier_context):
    response = cashier_context["client"].post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bdd-cashier-product"},
        json={"name": "Unauthorized Concha", "price_amount": "18.50"},
    )
    cashier_context["response"] = response


@then("the catalog request is rejected with permission denied")
def catalog_request_rejected(cashier_context):
    assert cashier_context["response"].status_code == 403


@given("two verified tenant owners for catalog isolation", target_fixture="isolation_context")
def two_verified_tenant_owners(db):
    client_a = TestClient(app)
    client_b = TestClient(app)
    _signup_verify_login(client_a, "catalog-a@example.com", "Catalog Tenant A")
    _signup_verify_login(client_b, "catalog-b@example.com", "Catalog Tenant B")
    return {"client_a": client_a, "client_b": client_b}


@when(parsers.parse('the first tenant creates a product named "{product_name}"'))
def first_tenant_creates_product(isolation_context, product_name):
    response = isolation_context["client_a"].post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": "bdd-isolation-product"},
        json={"name": product_name, "price_amount": "19.00"},
    )
    assert response.status_code == 201, response.text
    isolation_context["product_name"] = product_name


@then(parsers.parse('the second tenant cannot see "{product_name}" in their catalog'))
def second_tenant_cannot_see_product(isolation_context, product_name):
    response = isolation_context["client_b"].get("/api/v1/catalog/products")
    assert response.status_code == 200, response.text
    assert product_name not in {item["name"] for item in response.json()}

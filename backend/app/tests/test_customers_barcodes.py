from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.customers.models import Customer
from app.customers.schemas import CustomerWrite
from app.orders.models import Order, Refund
from app.tests.test_catalog import _signup_verify_login

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _customer(client, key="customer", name="Ana García"):
    response = client.post(
        "/api/v1/customers",
        headers={"Idempotency-Key": key},
        json={"name": name, "email": "ana@example.com", "phone": "5512345678"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_customers_replay_search_update_deactivation_and_private_audit(client, db):
    signup = _signup_verify_login(client, "customers-owner@example.com", "Clientes")
    customer = _customer(client)
    assert _customer(client) == customer
    assert db.query(Customer).filter(Customer.tenant_id == UUID(signup["tenant_id"])).count() == 1
    audit = db.query(AuditLog).filter(AuditLog.action == "customers.create").one()
    assert "Ana" not in str(audit.changes)
    assert "example.com" not in str(audit.changes)
    assert len(client.get("/api/v1/customers?q=garcía").json()) == 1
    assert client.get("/api/v1/customers?q=%25").json() == []
    response = client.put(
        f"/api/v1/customers/{customer['id']}",
        headers={"Idempotency-Key": "deactivate"},
        json={"name": customer["name"], "is_active": False},
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/customers").json() == []
    assert len(client.get("/api/v1/customers?include_inactive=true").json()) == 1


def test_customers_permissions_and_cross_tenant_ownership(client, db):
    first = _signup_verify_login(client, "customers-a@example.com", "Negocio A")
    customer = _customer(client)
    second = _signup_verify_login(client, "customers-b@example.com", "Negocio B")
    assert client.get("/api/v1/customers").json() == []
    assert client.get(f"/api/v1/customers/{customer['id']}/history").status_code == 404
    assert (
        client.put(
            f"/api/v1/customers/{customer['id']}",
            headers={"Idempotency-Key": "foreign"},
            json={"name": "Otro"},
        ).status_code
        == 404
    )
    membership = (
        db.query(Membership)
        .filter(
            Membership.tenant_id == UUID(second["tenant_id"]),
            Membership.user_id == UUID(second["user_id"]),
        )
        .one()
    )
    membership.role = "cashier"
    db.commit()
    assert client.get("/api/v1/customers").status_code == 200
    assert (
        client.post(
            "/api/v1/customers", headers={"Idempotency-Key": "cashier"}, json={"name": "Nuevo"}
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/customers/{customer['id']}/history").status_code == 403
    assert first["tenant_id"] != second["tenant_id"]


def test_customer_history_pagination_and_foreign_customer_fk(client, db):
    signup = _signup_verify_login(client, "customers-history@example.com", "Historial")
    customer = _customer(client)
    tenant_id = UUID(signup["tenant_id"])
    for _ in range(2):
        db.add(
            Order(
                tenant_id=tenant_id,
                branch_id=tenant_id,
                customer_id=UUID(customer["id"]),
                subtotal_amount=20,
                total_amount=20,
                status="completed",
            )
        )
    db.flush()
    order = (
        db.query(Order)
        .filter(Order.customer_id == UUID(customer["id"]))
        .order_by(Order.created_at.desc())
        .first()
    )
    db.add(
        Refund(
            tenant_id=tenant_id,
            branch_id=tenant_id,
            order_id=order.id,
            reason="other",
            refunded_amount=5,
        )
    )
    db.commit()
    response = client.get(f"/api/v1/customers/{customer['id']}/history?limit=1")
    assert response.status_code == 200, response.text
    assert len(response.json()["purchases"]) == 1
    assert response.json()["has_more"] is True
    assert response.json()["purchases"][0]["refunded_amount"] == "5.00"
    foreign = _signup_verify_login(client, "customers-history-other@example.com", "Otro")
    other_tenant = UUID(foreign["tenant_id"])
    db.add(
        Order(
            tenant_id=other_tenant,
            branch_id=other_tenant,
            customer_id=UUID(customer["id"]),
            subtotal_amount=20,
            total_amount=20,
            status="completed",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_barcode_uniqueness_normalization_clear_and_csv_import(client):
    _signup_verify_login(client, "barcodes@example.com", "Códigos")
    body = {"name": "Concha", "price_amount": "20", "barcode": " 001234 "}
    product = client.post(
        "/api/v1/catalog/products", headers={"Idempotency-Key": "barcode-one"}, json=body
    )
    assert product.status_code == 201, product.text
    assert product.json()["barcode"] == "001234"
    duplicate = client.post(
        "/api/v1/catalog/products", headers={"Idempotency-Key": "barcode-two"}, json=body
    )
    assert duplicate.status_code == 400, duplicate.text
    cleared = client.patch(
        f"/api/v1/catalog/products/{product.json()['id']}",
        headers={"Idempotency-Key": "barcode-clear"},
        json={"barcode": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["barcode"] is None
    imported = client.post(
        "/api/v1/catalog/import?dry_run=false",
        headers={"Idempotency-Key": "barcode-import", "Content-Type": "text/csv"},
        content=b"nombre,precio,codigo_barras\nPan,12,000123\n",
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["rows"][0]["normalized"]["barcode"] == "000123"
    assert any(p["barcode"] == "000123" for p in client.get("/api/v1/catalog/products").json())


def test_customer_input_validation():
    for body in (
        {"name": "   "},
        {"name": "<b>Ana</b>"},
        {"name": "Ana", "email": "wrong"},
        {"name": "Ana", "tenant_id": str(uuid4())},
    ):
        with pytest.raises((ValidationError, HTTPException)):
            CustomerWrite(**body)


def test_customers_postgres_rls_isolation(owner_engine, kova_app_engine):
    tenant_a, tenant_b, customer_a = uuid4(), uuid4(), uuid4()
    with owner_engine.begin() as conn:
        for tenant in (tenant_a, tenant_b):
            conn.execute(
                text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'RLS customers', :slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
        conn.execute(
            text(
                "INSERT INTO customers (id, tenant_id, name) VALUES (:id, :tenant, 'Private customer')"
            ),
            {"id": customer_a, "tenant": tenant_a},
        )
    try:
        with kova_app_engine.connect() as conn:
            assert conn.execute(text("SELECT id FROM customers")).all() == []
            conn.execute(
                text("SELECT set_config('app.tenant_id', :tenant, true)"), {"tenant": str(tenant_b)}
            )
            assert conn.execute(text("SELECT id FROM customers")).all() == []
            with pytest.raises(DBAPIError):
                conn.execute(
                    text(
                        "INSERT INTO customers (id, tenant_id, name) VALUES (:id, :tenant, 'Wrong tenant')"
                    ),
                    {"id": uuid4(), "tenant": tenant_a},
                )
            conn.rollback()
            conn.execute(
                text("SELECT set_config('app.tenant_id', :tenant, true)"), {"tenant": str(tenant_a)}
            )
            assert conn.execute(text("SELECT id FROM customers")).scalar_one() == customer_a
            with pytest.raises(DBAPIError):
                conn.execute(text("DELETE FROM customers WHERE id = :id"), {"id": customer_a})
            conn.rollback()
    finally:
        with owner_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": tenant_a, "b": tenant_b}
            )

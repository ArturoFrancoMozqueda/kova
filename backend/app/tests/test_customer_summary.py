from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.auth.models import Membership
from app.orders.models import Order, Refund
from app.tests.test_catalog import _signup_verify_login
from app.tests.test_customers_barcodes import _customer

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _order(db, tenant_id, customer_id, total, status="completed", occurred_at=None):
    order = Order(
        tenant_id=tenant_id,
        branch_id=tenant_id,
        customer_id=customer_id,
        subtotal_amount=total,
        total_amount=total,
        status=status,
        occurred_at=occurred_at,
    )
    db.add(order)
    db.flush()
    return order


def test_customer_without_purchases_has_zero_summary(client):
    _signup_verify_login(client, "summary-empty@example.com", "Resumen vacío")
    customer = _customer(client)
    response = client.get(f"/api/v1/customers/{customer['id']}/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["purchase_count"] == 0
    assert body["net_spent_amount"] == "0.00"
    assert body["average_ticket_amount"] is None
    assert body["last_purchase_at"] is None


def test_customer_summary_nets_refunds_and_ignores_voided_orders(client, db):
    signup = _signup_verify_login(client, "summary-net@example.com", "Resumen neto")
    customer = _customer(client)
    tenant_id = UUID(signup["tenant_id"])
    customer_id = UUID(customer["id"])
    first = _order(db, tenant_id, customer_id, 100, occurred_at=datetime(2026, 1, 5, tzinfo=UTC))
    _order(db, tenant_id, customer_id, "50.50", occurred_at=datetime(2026, 2, 7, tzinfo=UTC))
    _order(db, tenant_id, customer_id, 999, status="voided",
           occurred_at=datetime(2026, 3, 1, tzinfo=UTC))
    for amount in (20, 5):
        db.add(Refund(tenant_id=tenant_id, branch_id=tenant_id, order_id=first.id,
                      reason="other", refunded_amount=amount))
    db.commit()

    body = client.get(f"/api/v1/customers/{customer['id']}/summary").json()
    assert body["purchase_count"] == 2
    assert body["net_spent_amount"] == "125.50"
    assert body["average_ticket_amount"] == "62.75"
    assert body["last_purchase_at"].startswith("2026-02-07")


def test_customer_summary_is_tenant_scoped_and_permissioned(client, db):
    first = _signup_verify_login(client, "summary-a@example.com", "Resumen A")
    customer = _customer(client)
    _order(db, UUID(first["tenant_id"]), UUID(customer["id"]), 40)
    db.commit()
    second = _signup_verify_login(client, "summary-b@example.com", "Resumen B")
    assert client.get(f"/api/v1/customers/{customer['id']}/summary").status_code == 404
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
    assert client.get(f"/api/v1/customers/{customer['id']}/summary").status_code == 403

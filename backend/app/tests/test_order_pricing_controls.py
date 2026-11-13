"""Server-side discount, tax-rate and frozen-price controls for sales.

Online sales need orders.discount (owner/manager) for a manual discount or a tax
rate other than the tenant default. Offline syncs are already charged, so they
are never rejected for these controls; they leave an audit entry for review.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import event

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.orders.models import Order
from app.tests.test_orders import _create_product, _seed_stock, _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _set_role(db, signup: dict, role: str) -> None:
    membership = (
        db.query(Membership)
        .filter(
            Membership.tenant_id == UUID(signup["tenant_id"]),
            Membership.user_id == UUID(signup["user_id"]),
        )
        .one()
    )
    membership.role = role
    db.commit()


def _sale(product_id: str, *, discount="0.00", tax="0.00", amount="30.00") -> dict:
    return {
        "items": [{"product_id": product_id, "quantity": 3}],
        "discount_amount": discount,
        "tax_rate": tax,
        "payments": [{"method": "bank_transfer", "amount": amount}],
    }


def _orders(db, signup) -> int:
    return db.query(Order).filter(Order.tenant_id == UUID(signup["tenant_id"])).count()


def _set_default_tax(client, rate: str) -> None:
    saved = client.put(
        "/api/v1/settings/receipt",
        json={"receipt_business_name": "Caja", "default_tax_rate": rate},
    )
    assert saved.status_code == 200, saved.text


@pytest.mark.parametrize("role", ["cashier", "staff"])
def test_front_desk_online_discount_is_forbidden(client, db, role):
    signup = _signup_verify_login(client, f"discount-{role}@example.com", "Descuentos")
    product = _create_product(client, price="10.00")
    _set_role(db, signup, role)

    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"discount-{role}"},
        json=_sale(product["id"], discount="1.00", amount="29.00"),
    )

    assert response.status_code == 403, response.text
    assert "descuento" in response.json()["detail"]
    assert _orders(db, signup) == 0
    # The same sale without the discount still goes through.
    plain = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"plain-{role}"},
        json=_sale(product["id"]),
    )
    assert plain.status_code == 201, plain.text


def test_manager_can_discount_and_override_tax(client, db):
    signup = _signup_verify_login(client, "discount-manager@example.com", "Gerencia")
    product = _create_product(client, price="10.00")
    _set_role(db, signup, "manager")

    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "manager-discount"},
        json=_sale(product["id"], discount="1.00", tax="16.00", amount="33.64"),
    )

    assert response.status_code == 201, response.text
    assert response.json()["discount_amount"] == "1.00"
    assert response.json()["tax_amount"] == "4.64"


def test_cashier_must_use_the_tenant_default_tax_rate(client, db):
    signup = _signup_verify_login(client, "tax-cashier@example.com", "Impuestos")
    product = _create_product(client, price="10.00")
    _set_default_tax(client, "16.00")
    _set_role(db, signup, "cashier")

    lowered = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "tax-zero"},
        json=_sale(product["id"], tax="0.00"),
    )
    assert lowered.status_code == 403, lowered.text
    assert "tasa" in lowered.json()["detail"]
    assert _orders(db, signup) == 0

    default = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": "tax-default"},
        json=_sale(product["id"], tax="16", amount="34.80"),
    )
    assert default.status_code == 201, default.text
    assert default.json()["tax_amount"] == "4.80"


def test_offline_sale_without_permission_is_accepted_and_audited(client, db):
    signup = _signup_verify_login(client, "offline-review@example.com", "Revisión")
    product = _create_product(client, price="20.00")
    _set_role(db, signup, "cashier")
    payload = _sale(product["id"], discount="1.00", tax="16.00", amount="33.64")
    payload["items"][0]["unit_price_amount"] = "10.00"  # stale catalog price
    client_uuid = str(uuid4())
    request = {"sales": [{"client_uuid": client_uuid, "order": payload}]}

    first = client.post("/api/v1/sync/offline-sales", json=request)

    assert first.status_code == 200, first.text
    result = first.json()["results"][0]
    assert result["status"] == "synced", result
    assert result["order"]["total_amount"] == "33.64"
    reviews = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "orders.pricing_review",
        )
        .all()
    )
    assert len(reviews) == 1
    review = reviews[0]
    assert str(review.resource_id) == result["order_id"]
    assert review.changes["client_uuid"] == client_uuid
    assert review.changes["reasons"] == [
        "discount_without_permission",
        "tax_rate_without_permission",
        "unit_price_differs_from_catalog",
    ]
    assert review.changes["price_mismatches"] == [
        {
            "line": 0,
            "product_id": product["id"],
            "charged_unit_price": "10.00",
            "catalog_unit_price": "20.00",
        }
    ]
    # A replay neither duplicates the sale nor its review entry.
    again = client.post("/api/v1/sync/offline-sales", json=request)
    assert again.json()["results"][0]["order_id"] == result["order_id"]
    assert (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "orders.pricing_review",
        )
        .count()
        == 1
    )


def test_offline_sale_at_catalog_price_by_owner_is_not_flagged(client, db):
    signup = _signup_verify_login(client, "offline-clean@example.com", "Limpia")
    product = _create_product(client, price="10.00")
    payload = _sale(product["id"], discount="1.00", amount="29.00")
    payload["items"][0]["unit_price_amount"] = "10.00"
    request = {"sales": [{"client_uuid": str(uuid4()), "order": payload}]}

    response = client.post("/api/v1/sync/offline-sales", json=request)

    assert response.json()["results"][0]["status"] == "synced", response.text
    assert (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(signup["tenant_id"]),
            AuditLog.action == "orders.pricing_review",
        )
        .count()
        == 0
    )


def test_online_price_snapshot_is_still_rejected(client, db):
    signup = _signup_verify_login(client, "online-snapshot@example.com", "Snapshot")
    product = _create_product(client, price="10.00")
    payload = _sale(product["id"])
    payload["items"][0]["unit_price_amount"] = "1.00"

    response = client.post("/api/v1/orders", headers={"Idempotency-Key": "snap"}, json=payload)

    assert response.status_code == 400, response.text
    assert _orders(db, signup) == 0


def test_five_line_checkout_uses_batched_queries(client, db):
    _signup_verify_login(client, "checkout-queries@example.com", "Consultas")
    products = [
        _create_product(client, name=f"Pan {n}", price="10.00", track_inventory=True)
        for n in range(5)
    ]
    for product in products:
        _seed_stock(client, product["id"], qty=10)
    statements: list[str] = []

    def record_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(db.bind, "before_cursor_execute", record_sql)
    try:
        response = client.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": "five-lines"},
            json={
                "items": [{"product_id": p["id"], "quantity": 1} for p in products],
                "payments": [{"method": "bank_transfer", "amount": "50.00"}],
            },
        )
    finally:
        event.remove(db.bind, "before_cursor_execute", record_sql)

    assert response.status_code == 201, response.text
    assert len(response.json()["items"]) == 5
    locks = [s for s in statements if "FROM products" in s and "FOR UPDATE" in s]
    assert len(locks) == 1
    stock_reads = [s for s in statements if "sum(inventory_movements.quantity_delta)" in s]
    assert len(stock_reads) == 1
    # Before batching, the checkout section alone (product lock through the
    # sale audit) issued ~55 statements for this cart: one lock, two stock reads,
    # modifier lookups and three flushes per line, plus a full re-read. It is now
    # constant in the number of cart lines.
    start = statements.index(locks[0])
    end = next(n for n, s in enumerate(statements) if s.startswith("INSERT INTO audit_logs"))
    checkout = statements[start : end + 1]
    assert len(checkout) <= 20, "\n".join(checkout)
    assert len([s for s in checkout if s.startswith("INSERT INTO order_items")]) == 1

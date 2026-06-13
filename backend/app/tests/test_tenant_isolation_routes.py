"""Tenant isolation tests across every tenant-scoped router.

Creates two tenants, has tenant A write some resources, and confirms that
tenant B's authenticated session never sees them. Read-only endpoints are
checked for empty/zero responses; cross-tenant id lookups are checked for
404 or empty payloads — never 200 with leaked data.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient


def _signup_login(client: TestClient, *, email: str, tenant_name: str) -> None:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    token = r.json()["dev_verification_token"]
    client.post("/api/v1/auth/verify", json={"token": token})
    r = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert r.status_code == 200, r.text


def _two_tenants():
    from app.main import app

    a = TestClient(app)
    b = TestClient(app)
    a.__enter__()
    b.__enter__()
    _signup_login(a, email=f"iso-a-{uuid4().hex}@example.com", tenant_name="Iso Tenant A")
    _signup_login(b, email=f"iso-b-{uuid4().hex}@example.com", tenant_name="Iso Tenant B")
    return a, b


def test_catalog_isolation(db):  # noqa: ARG001 — db fixture wires the DB override
    a, b = _two_tenants()
    try:
        # Tenant A creates a product.
        r = a.post(
            "/api/v1/catalog/products",
            headers={"Idempotency-Key": uuid4().hex},
            json={"name": "Espresso", "price_amount": "30.00", "track_inventory": False},
        )
        assert r.status_code == 201, r.text
        product_a = r.json()

        # Tenant B should not see A's product in their list.
        r_b = b.get("/api/v1/catalog/products")
        assert r_b.status_code == 200
        assert all(p["id"] != product_a["id"] for p in r_b.json())

        # Tenant B cannot patch A's product (404 because lookup is tenant-scoped).
        r_b_patch = b.patch(
            f"/api/v1/catalog/products/{product_a['id']}",
            headers={"Idempotency-Key": uuid4().hex},
            json={"name": "Hijack"},
        )
        assert r_b_patch.status_code in (403, 404)
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_orders_and_reports_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        # Tenant A opens a shift so the cash sale below lands in an open drawer.
        r_shift = a.post(
            "/api/v1/shifts",
            headers={"Idempotency-Key": f"iso-shift-{uuid4().hex}"},
            json={"opening_cash_amount": "100.00"},
        )
        assert r_shift.status_code == 201, r_shift.text

        # Tenant A creates a product and a paid order.
        product = a.post(
            "/api/v1/catalog/products",
            headers={"Idempotency-Key": uuid4().hex},
            json={"name": "Latte", "price_amount": "55.00", "track_inventory": False},
        ).json()
        order = a.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": uuid4().hex},
            json={
                "items": [{"product_id": product["id"], "quantity": 1}],
                "payments": [
                    {"method": "cash", "amount": "55.00", "amount_tendered": "55.00"}
                ],
            },
        )
        assert order.status_code == 201, order.text
        order_id = order.json()["id"]

        # Tenant B sees no orders.
        r_orders = b.get("/api/v1/orders")
        assert r_orders.status_code == 200
        items = r_orders.json().get("items", [])
        assert all(o["id"] != order_id for o in items)

        # Tenant B sees zeroed sales summary.
        r_summary = b.get("/api/v1/reports/sales-summary")
        assert r_summary.status_code == 200
        assert Decimal(r_summary.json()["gross_sales"]) == Decimal("0.00")
        assert r_summary.json()["order_count"] == 0

        # Tenant B's business story has no completed orders.
        r_story = b.get("/api/v1/reports/business-story")
        assert r_story.status_code == 200
        assert r_story.json()["summary"]["completed_orders"] == 0

        # Tenant B cannot fetch A's order by id.
        r_detail = b.get(f"/api/v1/orders/{order_id}")
        assert r_detail.status_code in (403, 404)
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_inventory_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        a.post(
            "/api/v1/catalog/products",
            headers={"Idempotency-Key": uuid4().hex},
            json={"name": "Granos", "price_amount": "120.00", "track_inventory": True, "low_stock_threshold": 5},
        )
        # B sees an empty stock list because B has no tracked products.
        r_stock = b.get("/api/v1/inventory/stock")
        assert r_stock.status_code == 200
        assert r_stock.json() == []

        r_low = b.get("/api/v1/inventory/low-stock")
        assert r_low.status_code == 200
        assert r_low.json() == []

        r_velocity = b.get("/api/v1/inventory/velocity")
        assert r_velocity.status_code == 200
        assert r_velocity.json() == []
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_business_settings_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        # Fresh tenants get usable initial settings instead of setup-screen 404s.
        r_initial = a.get("/api/v1/settings/receipt")
        assert r_initial.status_code == 200
        assert r_initial.json()["receipt_business_name"] == "Iso Tenant A"

        # Each tenant configures their own profile, then reads it back.
        assert a.put(
            "/api/v1/settings/business-profile",
            json={"public_name": "Negocio A"},
        ).status_code == 200
        assert b.put(
            "/api/v1/settings/business-profile",
            json={"public_name": "Negocio B"},
        ).status_code == 200
        assert a.put(
            "/api/v1/settings/receipt",
            json={"receipt_business_name": "Recibo A", "footer": "Gracias"},
        ).status_code == 200
        assert b.put(
            "/api/v1/settings/receipt",
            json={"receipt_business_name": "Recibo B", "footer": "Vuelva pronto"},
        ).status_code == 200

        r_a = a.get("/api/v1/settings/business-profile")
        r_b = b.get("/api/v1/settings/business-profile")
        assert r_a.status_code == 200
        assert r_b.status_code == 200
        assert r_a.json()["tenant_id"] != r_b.json()["tenant_id"]
        assert r_a.json()["public_name"] == "Negocio A"
        assert r_b.json()["public_name"] == "Negocio B"

        receipt_a = a.get("/api/v1/settings/receipt")
        receipt_b = b.get("/api/v1/settings/receipt")
        assert receipt_a.status_code == 200
        assert receipt_b.status_code == 200
        assert receipt_a.json()["tenant_id"] != receipt_b.json()["tenant_id"]
        assert receipt_a.json()["receipt_business_name"] == "Recibo A"
        assert receipt_b.json()["receipt_business_name"] == "Recibo B"
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_employees_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        r_a = a.get("/api/v1/employees")
        r_b = b.get("/api/v1/employees")
        assert r_a.status_code == 200
        assert r_b.status_code == 200
        emails_a = {e["email"] for e in r_a.json()}
        emails_b = {e["email"] for e in r_b.json()}
        assert emails_a.isdisjoint(emails_b)
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_shifts_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        # Tenant A opens a shift.
        r_open = a.post(
            "/api/v1/shifts",
            headers={"Idempotency-Key": uuid4().hex},
            json={"opening_cash_amount": "500.00"},
        )
        assert r_open.status_code in (200, 201), r_open.text

        # Tenant B sees no active shift of A.
        r_b = b.get("/api/v1/shifts/current")
        assert r_b.status_code in (200, 204, 404)
        if r_b.status_code == 200 and r_b.json():
            body = r_b.json()
            assert body.get("id") != r_open.json().get("id")
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_modifiers_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        r_a = a.get("/api/v1/catalog/modifier-groups")
        r_b = b.get("/api/v1/catalog/modifier-groups")
        assert r_a.status_code == 200
        assert r_b.status_code == 200
        ids_a = {g["id"] for g in r_a.json()}
        ids_b = {g["id"] for g in r_b.json()}
        assert ids_a.isdisjoint(ids_b)
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)


def test_billing_subscription_isolation(db):  # noqa: ARG001
    a, b = _two_tenants()
    try:
        r_a = a.get("/api/v1/billing/subscription")
        r_b = b.get("/api/v1/billing/subscription")
        assert r_a.status_code == 200
        assert r_b.status_code == 200
        # Each tenant gets their own (independent) trial state.
        assert r_a.json()["access"]["allowed"] is True
        assert r_b.json()["access"]["allowed"] is True
    finally:
        a.__exit__(None, None, None)
        b.__exit__(None, None, None)

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.branches.scope import tenant_wide_branches
from app.orders.models import Order
from app.tests.test_orders import _create_product, _signup_verify_login

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _post(client, url, body, branch=None, key=None):
    headers = {"Idempotency-Key": key or str(uuid4())}
    if branch:
        headers["X-Kova-Branch"] = branch
    return client.post(url, json=body, headers=headers)


def _setup(client):
    signup = _signup_verify_login(
        client, f"branches-{uuid4().hex}@example.com", "Negocio multiubicación"
    )
    principal = signup["tenant_id"]
    created = _post(client, "/api/v1/branches", {"name": "Centro", "address": "Calle 1"})
    assert created.status_code == 201, created.text
    return principal, created.json()["id"]


def _sale(client, product_id, quantity, branch=None):
    response = _post(
        client,
        "/api/v1/orders",
        {
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payments": [
                {
                    "method": "cash",
                    "amount": str(quantity * 10),
                    "amount_tendered": str(quantity * 10),
                }
            ],
        },
        branch,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _open(client, branch):
    response = _post(client, "/api/v1/shifts", {"opening_cash_amount": "100.00"}, branch)
    assert response.status_code == 201, response.text
    return response.json()


def _report(client, branch=None):
    day = datetime.now(ZoneInfo("America/Mexico_City")).date().isoformat()
    headers = {"X-Kova-Branch": branch} if branch else {}
    response = client.get(
        f"/api/v1/reports/branches?start_date={day}&end_date={day}", headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_branches_create_rename_and_idempotency(client):
    principal, branch = _setup(client)
    listed = client.get("/api/v1/branches").json()
    assert {b["id"] for b in listed} == {principal, branch}
    response = client.patch(
        f"/api/v1/branches/{branch}",
        json={"name": "Norte", "address": None},
        headers={"Idempotency-Key": "rename-norte"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Norte"
    payload = {"name": "Sur"}
    one = _post(client, "/api/v1/branches", payload, key="sur")
    two = _post(client, "/api/v1/branches", payload, key="sur")
    assert one.json()["id"] == two.json()["id"]
    duplicate = _post(client, "/api/v1/branches", payload)
    assert duplicate.status_code == 409
    assert _post(client, "/api/v1/branches", {"name": "  "}).status_code == 422


def test_simultaneous_branch_drawers_inventory_and_refunded_comparison(client):
    principal, branch = _setup(client)
    shift_a, shift_b = _open(client, principal), _open(client, branch)
    assert shift_a["id"] != shift_b["id"]
    assert _post(client, "/api/v1/shifts", {}, branch).status_code == 400
    product = _create_product(client, name="Pan", price="10.00", track_inventory=True)
    for location, quantity in [(principal, 10), (branch, 20)]:
        seed = _post(
            client,
            f"/api/v1/inventory/products/{product['id']}/adjustments",
            {"quantity_delta": quantity, "reason": "Recepción"},
            location,
        )
        assert seed.status_code == 201, seed.text
    sale_a = _sale(client, product["id"], 2, principal)
    sale_b = _sale(client, product["id"], 3, branch)
    assert sale_a["branch_id"] == principal
    assert sale_b["branch_id"] == branch
    refund = _post(
        client,
        f"/api/v1/orders/{sale_b['id']}/refunds",
        {
            "reason": "customer_return",
            "refund_payment_method": "cash",
            "items": [{"order_item_id": sale_b["items"][0]["id"], "quantity": 1}],
        },
        branch,
    )
    assert refund.status_code == 201, refund.text
    for location, expected in [(principal, 8), (branch, 18)]:
        stock = client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": location}).json()
        assert stock[0]["stock_on_hand"] == expected
        orders = client.get("/api/v1/orders", headers={"X-Kova-Branch": location}).json()
        assert orders["total"] == 1
        opened = client.get("/api/v1/shifts/current", headers={"X-Kova-Branch": location})
        assert opened.status_code == 200, opened.text
        assert Decimal(opened.json()["expected_cash_amount"]) == Decimal("120.00")
    report = _report(client, branch)
    assert Decimal(report["total_net_sales"]) == Decimal("40")
    assert set(report["leader_branch_ids"]) == {principal, branch}
    for row in report["branches"]:
        assert Decimal(row["net_sales"]) == Decimal("20")
        assert row["products"][0]["net_quantity"] == 2
        assert Decimal(row["products"][0]["net_sales"]) == Decimal("20")
    void = _post(
        client, f"/api/v1/orders/{sale_a['id']}/void", {"reason": "operator_error"}, principal
    )
    assert void.status_code == 201, void.text
    after = _report(client)
    assert after["leader_branch_ids"] == [branch]
    assert Decimal(after["total_net_sales"]) == Decimal("20")
    assert next(row for row in after["branches"] if row["branch_id"] == principal)["products"] == []


def test_other_branch_records_and_foreign_tenant_are_rejected(client):
    principal, branch = _setup(client)
    _open(client, branch)
    product = _create_product(client, price="10.00")
    sale = _sale(client, product["id"], 1, branch)
    assert (
        client.get(f"/api/v1/orders/{sale['id']}", headers={"X-Kova-Branch": principal}).status_code
        == 404
    )
    assert (
        client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": str(uuid4())}).status_code
        == 404
    )
    assert client.get("/api/v1/branches", headers={"X-Kova-Branch": "bad"}).status_code == 422
    _signup_verify_login(client, f"other-{uuid4().hex}@example.com", "Otro negocio")
    assert client.get("/api/v1/branches", headers={"X-Kova-Branch": branch}).status_code == 404
    patch = client.patch(
        f"/api/v1/branches/{branch}", json={"name": "Ajena"}, headers={"Idempotency-Key": "foreign"}
    )
    assert patch.status_code == 404


def test_empty_branches_have_no_invented_winner(client):
    principal, branch = _setup(client)
    report = _report(client)
    assert report["leader_branch_ids"] == []
    assert len(report["branches"]) == 2
    assert {row["branch_id"] for row in report["branches"]} == {principal, branch}
    assert all(row["products"] == [] and row["completed_orders"] == 0 for row in report["branches"])


def test_offline_mixed_branch_batch_legacy_origin_and_replay(client, db):
    principal, branch = _setup(client)
    product = _create_product(client, price="10.00")
    order = {
        "items": [{"product_id": product["id"], "quantity": 1}],
        "payments": [{"method": "manual_card", "amount": "10.00"}],
    }
    legacy = {"client_uuid": str(uuid4()), "order": order}
    at_branch = {"client_uuid": str(uuid4()), "branch_id": branch, "order": order}
    bad = {"client_uuid": str(uuid4()), "branch_id": str(uuid4()), "order": order}
    payload = {"sales": [legacy, bad, at_branch]}
    first = client.post(
        "/api/v1/sync/offline-sales", json=payload, headers={"X-Kova-Branch": branch}
    )
    results = first.json()["results"]
    assert [row["status"] for row in results] == ["synced", "failed", "synced"]
    assert results[0]["order"]["branch_id"] == principal
    assert results[2]["order"]["branch_id"] == branch
    repeated = client.post("/api/v1/sync/offline-sales", json=payload).json()["results"]
    assert results[0]["order_id"] == repeated[0]["order_id"]
    assert results[2]["order_id"] == repeated[2]["order_id"]
    moved = dict(at_branch, branch_id=principal)
    wrong = client.post("/api/v1/sync/offline-sales", json={"sales": [moved]}).json()["results"][0]
    assert wrong["status"] == "failed"
    with tenant_wide_branches(db):
        assert db.query(Order).filter(Order.tenant_id == UUID(principal)).count() == 2


def test_branch_scope_is_part_of_financial_idempotency(client):
    principal, branch = _setup(client)
    first = _post(client, "/api/v1/shifts", {}, principal, "one-key")
    second = _post(client, "/api/v1/shifts", {}, branch, "one-key")
    assert first.status_code == 201
    assert second.status_code == 400
    assert client.get("/api/v1/shifts/current", headers={"X-Kova-Branch": branch}).json() is None


def test_branch_foreign_key_rejects_cross_branch_drawer(client, db):
    principal, branch = _setup(client)
    shift = _open(client, principal)
    # Verify the SQL constraint, independently of request validation/ORM scope.
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text("""INSERT INTO orders
            (id, tenant_id, branch_id, shift_id, status, subtotal_amount, total_amount)
            VALUES (:id, :tenant, :branch, :shift, 'completed', 10, 10)"""),
            {
                "id": uuid4(),
                "tenant": UUID(principal),
                "branch": UUID(branch),
                "shift": UUID(shift["id"]),
            },
        )


def test_branch_management_and_comparison_preserve_role_permissions(client, db):
    from app.auth.models import Membership

    principal, branch = _setup(client)
    membership = db.query(Membership).filter(Membership.tenant_id == UUID(principal)).one()
    membership.role = "cashier"
    db.commit()
    assert client.get("/api/v1/branches").status_code == 200
    assert _post(client, "/api/v1/branches", {"name": "No permitido"}).status_code == 403
    assert client.get("/api/v1/reports/branches").status_code == 403
    assert (
        client.patch(
            f"/api/v1/branches/{branch}",
            json={"name": "No permitido"},
            headers={"Idempotency-Key": str(uuid4())},
        ).status_code
        == 403
    )


def test_branches_enforce_real_postgres_rls(owner_engine, kova_app_engine):
    from sqlalchemy.exc import DBAPIError
    from sqlalchemy.orm import Session

    from app.branches.models import Branch
    from app.db import set_tenant_context

    tenant_a, tenant_b = uuid4(), uuid4()
    with owner_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:a, 'A', :sa), (:b, 'B', :sb)"),
            {"a": tenant_a, "b": tenant_b, "sa": f"branch-{tenant_a}", "sb": f"branch-{tenant_b}"},
        )
    try:
        with Session(kova_app_engine) as runtime:
            set_tenant_context(runtime, tenant_a)
            assert {b.id for b in runtime.query(Branch).all()} == {tenant_a}
            runtime.commit()
            # Context is restored after commit and foreign tenant remains invisible.
            assert runtime.query(Branch).filter(Branch.id == tenant_b).first() is None
            with pytest.raises(DBAPIError) as error, runtime.begin_nested():
                runtime.execute(
                    text(
                        "INSERT INTO branches (id, tenant_id, name) VALUES (:id, :tenant, 'Wrong')"
                    ),
                    {"id": uuid4(), "tenant": tenant_b},
                )
            assert error.value.orig.sqlstate == "42501"
            with pytest.raises(DBAPIError) as error, runtime.begin_nested():
                runtime.execute(
                    text("UPDATE branches SET tenant_id = :b WHERE id = :a"),
                    {"a": tenant_a, "b": tenant_b},
                )
            assert error.value.orig.sqlstate == "42501"
    finally:
        with owner_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": tenant_a, "b": tenant_b}
            )


def test_fiscal_preview_consolidates_branches_regardless_of_selected_drawer(client, db):
    from datetime import date

    from app.tests.test_fiscal_global_drafts import _daily_settings, _enable, _set_sale_day

    principal, branch = _setup(client)
    _enable(db, UUID(principal))
    _daily_settings(client)
    product = _create_product(client, price="10.00")
    day = date(2026, 7, 1)
    for location, quantity in [(principal, 1), (branch, 2)]:
        sale = _post(
            client,
            "/api/v1/orders",
            {
                "items": [{"product_id": product["id"], "quantity": quantity}],
                "payments": [{"method": "bank_transfer", "amount": str(quantity * 10)}],
            },
            location,
        )
        assert sale.status_code == 201, sale.text
        _set_sale_day(db, sale.json()["id"], day)
    for location in [principal, branch]:
        preview = client.get(
            "/api/v1/fiscal/global-drafts/preview",
            params={"period_end": day.isoformat()},
            headers={"X-Kova-Branch": location},
        )
        assert preview.status_code == 200, preview.text
        assert Decimal(preview.json()["total_amount"]) == Decimal("30")


def test_product_rename_does_not_split_sales_of_same_sku(client):
    principal, branch = _setup(client)
    _open(client, branch)
    product = _create_product(client, name="Pan antes", price="10.00")
    _sale(client, product["id"], 1, branch)
    changed = client.patch(
        f"/api/v1/catalog/products/{product['id']}",
        json={"name": "Pan nuevo"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert changed.status_code == 200, changed.text
    _sale(client, product["id"], 2, branch)
    products = next(row for row in _report(client)["branches"] if row["branch_id"] == branch)[
        "products"
    ]
    assert len(products) == 1
    assert products[0]["product_name"] == "Pan nuevo"
    assert products[0]["net_quantity"] == 3
    assert Decimal(products[0]["net_sales"]) == Decimal("30")


def test_pending_customer_orders_reserve_only_their_own_branch(client, db):
    from app.tests.test_customer_orders import _enable_customer_orders

    principal, branch = _setup(client)
    _enable_customer_orders(db, UUID(principal))
    product = _create_product(client, price="10.00", track_inventory=True)
    for location in [principal, branch]:
        stock = _post(
            client,
            f"/api/v1/inventory/products/{product['id']}/adjustments",
            {"quantity_delta": 3, "reason": "Recepción"},
            location,
        )
        assert stock.status_code == 201, stock.text
    created = _post(
        client,
        "/api/v1/customer-orders",
        {"items": [{"product_id": product["id"], "quantity": 2}]},
        branch,
    )
    assert created.status_code == 201, created.text
    order = created.json()
    confirm_url = f"/api/v1/customer-orders/{order['id']}/confirm"
    assert _post(client, confirm_url, {"version": order["version"]}, principal).status_code == 404
    confirmed = _post(client, confirm_url, {"version": order["version"]}, branch)
    assert confirmed.status_code == 200, confirmed.text
    for location, reserved in [(principal, 0), (branch, 2)]:
        rows = client.get("/api/v1/inventory/stock", headers={"X-Kova-Branch": location}).json()
        stock = next(row for row in rows if row["product_id"] == product["id"])
        assert stock["reserved_quantity"] == reserved
        assert stock["available_quantity"] == 3 - reserved
    assert client.get("/api/v1/customer-orders").json()["total"] == 0


def test_expenses_cannot_be_edited_or_deleted_from_another_branch(client):
    principal, branch = _setup(client)
    created = _post(
        client,
        "/api/v1/expenses",
        {"category": "renta", "amount": "100.00", "expense_date": "2026-10-04"},
        branch,
    )
    assert created.status_code == 201, created.text
    expense_id = created.json()["id"]
    assert client.get("/api/v1/expenses").json() == []
    for method, body in [("PATCH", {"amount": "200.00"}), ("DELETE", None)]:
        response = client.request(
            method,
            f"/api/v1/expenses/{expense_id}",
            json=body,
            headers={"Idempotency-Key": str(uuid4()), "X-Kova-Branch": principal},
        )
        assert response.status_code == 404, response.text
    rows = client.get("/api/v1/expenses", headers={"X-Kova-Branch": branch}).json()
    assert rows[0]["id"] == expense_id and Decimal(rows[0]["amount"]) == Decimal("100")


def test_database_rejects_reassigning_a_registered_sale(client, db):
    from sqlalchemy.exc import DBAPIError

    principal, branch = _setup(client)
    product = _create_product(client, price="10.00")
    sale = _post(
        client,
        "/api/v1/orders",
        {
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [{"method": "bank_transfer", "amount": "10.00"}],
        },
        branch,
    )
    assert sale.status_code == 201, sale.text
    with pytest.raises(DBAPIError) as error, db.begin_nested():
        db.execute(
            text("UPDATE orders SET branch_id = :principal WHERE id = :id"),
            {"principal": UUID(principal), "id": UUID(sale.json()["id"])},
        )
    assert error.value.orig.sqlstate == "23514"

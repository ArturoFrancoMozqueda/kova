"""Deposits on customer orders: quote a cake, take a deposit, settle it without counting twice."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.customer_orders.models import CustomerOrderDeposit
from app.shifts.calculator import calculate_expected_cash
from app.shifts.models import CashMovement
from app.tests.test_customer_orders import (
    _confirm,
    _create,
    _enable_customer_orders,
    _product,
    _seed,
)
from app.tests.test_orders import _open_shift

pytestmark = pytest.mark.usefixtures("fast_business_auth")
PASSWORD = "S3cur3pass!"


def _owner(client, db: Session, prefix: str) -> tuple[UUID, str]:
    email = f"{prefix}-{uuid4().hex}@example.com"
    signup = client.post("/api/v1/auth/signup", json={
        "email": email, "password": PASSWORD, "tenant_name": f"Pastelería {prefix}",
        "accepted_terms": True,
    })
    assert signup.status_code == 201, signup.text
    assert client.post("/api/v1/auth/verify",
                       json={"token": signup.json()["dev_verification_token"]}).status_code == 200
    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    tenant_id = UUID(signup.json()["tenant_id"])
    _enable_customer_orders(db, tenant_id)
    return tenant_id, email


def _as_role(client, db: Session, tenant_id: UUID, email: str, role: str) -> None:
    membership = db.query(Membership).filter(Membership.tenant_id == tenant_id).one()
    membership.role = role
    db.commit()
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert client.post("/api/v1/auth/login",
                       json={"email": email, "password": PASSWORD}).status_code == 200


def _post(client, path: str, body: dict, key: str | None = None):
    return client.post(f"/api/v1/customer-orders/{path}", json=body,
                       headers={"Idempotency-Key": key or str(uuid4())})


def _settings(client, percent: str = "0", policy: str = "refund"):
    response = client.put("/api/v1/customer-orders/settings", json={
        "deposit_minimum_percent": percent, "cancelled_deposit_policy": policy,
    })
    assert response.status_code == 200, response.text
    return response.json()


def _cake_order(client, *, price: str = "300.00", quantity: int = 2) -> dict:
    cake = _product(client, name="Pastel de tres leches", price=price)
    _seed(client, cake["id"], 5)
    created = _create(client, cake["id"], quantity=quantity)
    assert created.status_code == 201, created.text
    return created.json()


def _deposit(client, order: dict, amount: str, method: str = "cash", key: str | None = None):
    return _post(client, f"{order['id']}/deposits",
                 {"version": order["version"], "method": method, "amount": amount}, key)


def test_cake_with_deposit_is_settled_once_and_the_drawer_balances(client, db: Session) -> None:
    tenant_id, _ = _owner(client, db, "integral")
    _settings(client, percent="50")
    order = _cake_order(client)  # 2 × $300 = $600

    blocked = _confirm(client, order)
    assert blocked.status_code == 422
    assert blocked.json()["detail"]["code"] == "DEPOSIT_REQUIRED"
    assert blocked.json()["detail"]["required_amount"] == "300.00"
    assert order["deposits"]["minimum_amount"] == "300.00"

    no_shift = _deposit(client, order, "300.00")
    assert no_shift.status_code == 400
    shift = _open_shift(client)  # $100 opening cash
    received = _deposit(client, order, "300.00", key="cake-deposit")
    assert received.status_code == 201, received.text
    replay = _deposit(client, order, "300.00", key="cake-deposit")
    assert replay.json() == received.json()
    order = received.json()
    assert (order["deposits"]["balance_amount"], order["deposits"]["due_amount"]) == (
        "300.00", "300.00")
    assert db.query(CustomerOrderDeposit).filter_by(customer_order_id=UUID(order["id"])).count() == 1
    movement = db.query(CashMovement).filter_by(shift_id=UUID(shift["id"]), type="cash_in").one()
    assert movement.amount == Decimal("300.00") and order["folio"] in movement.reason
    # The deposit is in the drawer the day it arrives, but it is not a sale.
    assert calculate_expected_cash(db, tenant_id=tenant_id, shift_id=shift["id"]) == Decimal("400.00")
    summary = client.get("/api/v1/reports/sales-summary").json()
    assert Decimal(summary["gross_sales"]) == 0

    order = _confirm(client, order).json()
    assert order["status"] == "confirmed"
    for status in ("in_progress", "ready"):
        order = _post(client, f"{order['id']}/status",
                      {"version": order["version"], "status": status}).json()

    full = _post(client, f"{order['id']}/checkout", {"version": order["version"], "payments": [
        {"method": "cash", "amount": "600.00", "amount_tendered": "600.00"}]})
    assert full.status_code == 422
    assert full.json()["detail"]["code"] == "PAYMENT_MISMATCH"
    assert full.json()["detail"]["due_amount"] == "300.00"

    settled = _post(client, f"{order['id']}/checkout", {"version": order["version"], "payments": [
        {"method": "cash", "amount": "300.00", "amount_tendered": "500.00"}]})
    assert settled.status_code == 201, settled.text
    sale = settled.json()["sale_order"]
    assert sale["total_amount"] == "600.00"
    assert sorted((p["amount_amount"], p.get("deposit_applied", False)) for p in sale["payments"]) \
        == [("300.00", False), ("300.00", True)]
    order = settled.json()["customer_order"]
    assert (order["payment_status"], order["deposits"]["balance_amount"],
            order["deposits"]["due_amount"], order["deposits"]["applied"]) == (
        "paid", "0.00", "0.00", True)
    # Income counts once ($600) and the drawer holds $100 + $300 + $300, not $1,000.
    assert calculate_expected_cash(db, tenant_id=tenant_id, shift_id=shift["id"]) == Decimal("700.00")
    summary = client.get("/api/v1/reports/sales-summary").json()
    assert Decimal(summary["gross_sales"]) == Decimal("600.00")

    delivered = _post(client, f"{order['id']}/status",
                      {"version": order["version"], "status": "fulfilled"})
    assert delivered.status_code == 200, delivered.text


def test_deposit_covering_the_whole_order_needs_no_payment(client, db: Session) -> None:
    _owner(client, db, "full")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "300.00", method="bank_transfer").json()
    order = _confirm(client, order).json()
    settled = _post(client, f"{order['id']}/checkout", {"version": order["version"]})
    assert settled.status_code == 201, settled.text
    payments = settled.json()["sale_order"]["payments"]
    assert [(p["method"], p["amount_amount"], p["deposit_applied"]) for p in payments] == [
        ("bank_transfer", "300.00", True)]


def test_deposit_cannot_exceed_the_order_total(client, db: Session) -> None:
    _owner(client, db, "exceed")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "200.00", method="manual_card").json()
    too_much = _deposit(client, order, "150.00", method="manual_card")
    assert too_much.status_code == 422
    assert too_much.json()["detail"]["code"] == "DEPOSIT_EXCEEDS_TOTAL"
    stale = _deposit(client, {**order, "version": order["version"] - 1}, "10.00", "manual_card")
    assert stale.status_code == 409


def test_cancelling_returns_the_deposit_by_default(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "cancel-refund")
    shift = _open_shift(client)
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "100.00").json()
    order = _deposit(client, order, "50.00", method="bank_transfer").json()

    _as_role(client, db, tenant_id, email, "cashier")
    cashier = _post(client, f"{order['id']}/cancel", {
        "version": order["version"], "reason": "customer_request", "deposit_resolution": "refund"})
    assert cashier.status_code == 403
    _as_role(client, db, tenant_id, email, "owner")

    unresolved = _post(client, f"{order['id']}/cancel",
                       {"version": order["version"], "reason": "customer_request"})
    assert unresolved.status_code == 409
    assert unresolved.json()["detail"]["code"] == "DEPOSIT_RESOLUTION_REQUIRED"
    assert unresolved.json()["detail"]["policy"] == "refund"
    kept = _post(client, f"{order['id']}/cancel", {
        "version": order["version"], "reason": "customer_request", "deposit_resolution": "retain"})
    assert kept.json()["detail"]["code"] == "DEPOSIT_RETAIN_NOT_ALLOWED"

    cancelled = _post(client, f"{order['id']}/cancel", {
        "version": order["version"], "reason": "customer_request", "deposit_resolution": "refund"})
    assert cancelled.status_code == 200, cancelled.text
    body = cancelled.json()
    assert (body["status"], body["deposits"]["balance_amount"]) == ("cancelled", "0.00")
    refunds = sorted((e["method"], e["amount"]) for e in body["deposits"]["entries"]
                     if e["kind"] == "refund")
    assert refunds == [("bank_transfer", "50.00"), ("cash", "100.00")]
    # The cash came in and went back out of the same drawer.
    assert calculate_expected_cash(db, tenant_id=tenant_id, shift_id=shift["id"]) == Decimal("100.00")


def test_business_can_keep_the_deposit_and_it_is_reported_apart_from_sales(
    client, db: Session
) -> None:
    _owner(client, db, "cancel-retain")
    _settings(client, policy="retain")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "120.00", method="bank_transfer").json()
    kept = _post(client, f"{order['id']}/cancel", {
        "version": order["version"], "reason": "customer_request", "note": "No se presentó",
        "deposit_resolution": "retain"})
    assert kept.status_code == 200, kept.text
    entry = kept.json()["deposits"]["entries"][-1]
    assert (entry["kind"], entry["amount"], entry["method"]) == ("retained", "120.00", None)
    summary = client.get("/api/v1/reports/sales-summary").json()
    assert (Decimal(summary["gross_sales"]), Decimal(summary["retained_deposits"]),
            summary["retained_deposit_count"]) == (0, Decimal("120.00"), 1)


def test_part_of_a_deposit_can_be_returned_by_a_manager(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "partial-refund")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "200.00", method="bank_transfer").json()
    path = f"{order['id']}/deposits/refund"
    wrong_method = _post(client, path, {"version": order["version"], "method": "manual_card",
                                        "amount": "50.00", "reason": "Cambio de pedido"})
    assert wrong_method.status_code == 422
    assert wrong_method.json()["detail"]["code"] == "DEPOSIT_REFUND_EXCEEDS_BALANCE"
    returned = _post(client, path, {"version": order["version"], "method": "bank_transfer",
                                    "amount": "50.00", "reason": "Cambio de pedido"})
    assert returned.status_code == 200, returned.text
    assert returned.json()["deposits"]["balance_amount"] == "150.00"
    _as_role(client, db, tenant_id, email, "cashier")
    order = returned.json()
    assert _post(client, path, {"version": order["version"], "method": "bank_transfer",
                                "amount": "10.00", "reason": "Otro"}).status_code == 403


def test_voiding_the_settled_sale_frees_the_deposit_again(client, db: Session) -> None:
    _owner(client, db, "void")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "100.00", method="bank_transfer").json()
    order = _confirm(client, order).json()
    settled = _post(client, f"{order['id']}/checkout", {"version": order["version"], "payments": [
        {"method": "manual_card", "amount": "200.00"}]}).json()
    voided = client.post(f"/api/v1/orders/{settled['sale_order']['id']}/void",
                         json={"reason": "operator_error"},
                         headers={"Idempotency-Key": str(uuid4())})
    assert voided.status_code == 201, voided.text
    order = client.get(f"/api/v1/customer-orders/{order['id']}").json()
    assert (order["payment_status"], order["deposits"]["balance_amount"]) == ("voided", "100.00")
    listed = client.get("/api/v1/customer-orders").json()["items"]
    assert next(row for row in listed if row["id"] == order["id"])[
        "deposit_balance_amount"] == "100.00"
    unresolved = _post(client, f"{order['id']}/cancel",
                       {"version": order["version"], "reason": "other"})
    assert unresolved.json()["detail"]["code"] == "DEPOSIT_RESOLUTION_REQUIRED"


def test_settings_default_validate_and_need_permission(client, db: Session) -> None:
    tenant_id, email = _owner(client, db, "settings")
    assert client.get("/api/v1/customer-orders/settings").json() == {
        "deposit_minimum_percent": "0.00", "cancelled_deposit_policy": "refund"}
    assert client.put("/api/v1/customer-orders/settings", json={
        "deposit_minimum_percent": "101", "cancelled_deposit_policy": "refund"}).status_code == 422
    assert _settings(client, "30", "retain") == {
        "deposit_minimum_percent": "30.00", "cancelled_deposit_policy": "retain"}
    _as_role(client, db, tenant_id, email, "cashier")
    assert client.put("/api/v1/customer-orders/settings", json={
        "deposit_minimum_percent": "0", "cancelled_deposit_policy": "refund"}).status_code == 403


def test_deposits_stay_inside_the_business(client, db: Session) -> None:
    _owner(client, db, "tenant-a")
    order = _cake_order(client, quantity=1)
    order = _deposit(client, order, "80.00", method="bank_transfer").json()
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _owner(client, db, "tenant-b")
    assert _deposit(client, order, "10.00", method="bank_transfer").status_code == 404
    assert client.get(f"/api/v1/customer-orders/{order['id']}").status_code == 404

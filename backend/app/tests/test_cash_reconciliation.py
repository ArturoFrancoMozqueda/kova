"""Cash-drawer reconciliation: expected cash must include cash sales.

Regression coverage for the P0 fix where `calculate_expected_cash` ignored
cash collected from sales, so every shift with cash sales closed with a false
overage. Expected cash is now:

    opening + cash_sales + cash_in - cash_out - refund_payout

These tests drive the real HTTP surface (open shift -> sell -> close) so they
protect the cashier-facing promise that the drawer cuadra at close.
"""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": tenant_name,
            "accepted_terms": True,
        },
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


def _create_product(client: TestClient, *, name: str, price: str) -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"cash-recon-product-{uuid4().hex}"},
        json={"name": name, "price_amount": price},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _open_shift(client: TestClient, *, opening: str) -> dict:
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"cash-recon-open-{uuid4().hex}"},
        json={"opening_cash_amount": opening},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_order(client: TestClient, *, payments: list[dict], items: list[dict]) -> dict:
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"cash-recon-order-{uuid4().hex}"},
        json={"items": items, "payments": payments},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _close_shift(client: TestClient, shift_id: str, *, actual: str) -> dict:
    response = client.post(
        f"/api/v1/shifts/{shift_id}/close",
        headers={"Idempotency-Key": f"cash-recon-close-{uuid4().hex}"},
        json={"actual_cash_amount": actual},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _new_client(tenant: str) -> TestClient:
    client = TestClient(app)
    _signup_verify_login(client, f"cash-recon-{uuid4().hex}@example.com", tenant)
    return client


def test_cash_sale_balances_at_close():
    client = _new_client("Cash Sale Balance")
    product = _create_product(client, name="Latte", price="50.00")
    shift = _open_shift(client, opening="100.00")

    _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
    )

    # Live expected (open shift) reflects opening + the cash sale.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "150.00"

    closed = _close_shift(client, shift["id"], actual="150.00")
    assert closed["reconciliation_status"] == "balanced"
    assert closed["variance_amount"] == "0.00"
    assert closed["expected_cash_amount"] == "150.00"


def test_split_payment_counts_only_cash_portion():
    client = _new_client("Split Payment")
    product = _create_product(client, name="Combo", price="50.00")
    shift = _open_shift(client, opening="100.00")

    _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
    )

    # Only the 30.00 cash portion hits the drawer; the 20.00 transfer does not.
    closed = _close_shift(client, shift["id"], actual="130.00")
    assert closed["reconciliation_status"] == "balanced"
    assert closed["variance_amount"] == "0.00"


def test_non_cash_sale_does_not_change_drawer():
    client = _new_client("Card Only")
    product = _create_product(client, name="Pastel", price="40.00")
    shift = _open_shift(client, opening="100.00")

    _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "bank_transfer", "amount": "40.00"}],
    )

    closed = _close_shift(client, shift["id"], actual="100.00")
    assert closed["reconciliation_status"] == "balanced"


def test_void_removes_cash_sale_from_expected():
    client = _new_client("Void Cash Sale")
    product = _create_product(client, name="Jugo", price="50.00")
    shift = _open_shift(client, opening="100.00")

    order = _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
    )

    void = client.post(
        f"/api/v1/orders/{order['id']}/void",
        headers={"Idempotency-Key": f"cash-recon-void-{uuid4().hex}"},
        json={"reason": "operator_error"},
    )
    assert void.status_code == 201, void.text

    # Voided order drops out of expected cash (status != completed): drawer is
    # back to opening, no double-counting via a separate reversal movement.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "100.00"

    closed = _close_shift(client, shift["id"], actual="100.00")
    assert closed["reconciliation_status"] == "balanced"


def test_offline_synced_sale_excluded_from_current_shift():
    client = _new_client("Offline Sync Shift")
    product = _create_product(client, name="Concha", price="50.00")
    shift = _open_shift(client, opening="100.00")

    sync = client.post(
        "/api/v1/sync/offline-sales",
        json={
            "sales": [
                {
                    "client_uuid": str(uuid4()),
                    "order": {
                        "items": [{"product_id": product["id"], "quantity": 1}],
                        "payments": [
                            {"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}
                        ],
                    },
                }
            ]
        },
    )
    assert sync.status_code == 200, sync.text
    assert sync.json()["results"][0]["status"] == "synced"

    # Offline sale is NOT attributed to the current drawer, so expected stays
    # at the opening balance.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "100.00"

    closed = _close_shift(client, shift["id"], actual="100.00")
    assert closed["reconciliation_status"] == "balanced"


def test_sale_without_open_shift_still_succeeds():
    """Contract preserved: the backend does not yet require an open shift.

    The order is recorded unattributed (no shift) — documents current behavior
    pending the separate 'require open shift' decision.
    """
    client = _new_client("No Shift Sale")
    product = _create_product(client, name="Te", price="25.00")

    order = _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "25.00", "amount_tendered": "25.00"}],
    )
    assert order["status"] == "completed"

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


def _post_order(client: TestClient, *, payments: list[dict], items: list[dict]):
    return client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": f"cash-recon-order-{uuid4().hex}"},
        json={"items": items, "payments": payments},
    )


def _create_order(client: TestClient, *, payments: list[dict], items: list[dict]) -> dict:
    response = _post_order(client, payments=payments, items=items)
    assert response.status_code == 201, response.text
    return response.json()


def _sync_sale(
    client: TestClient,
    *,
    product_id: str,
    payments: list[dict],
    client_uuid: str | None = None,
    shift_id: str | None = None,
    quantity: int = 1,
):
    item: dict = {
        "client_uuid": client_uuid or str(uuid4()),
        "order": {
            "items": [{"product_id": product_id, "quantity": quantity}],
            "payments": payments,
        },
    }
    if shift_id is not None:
        item["shift_id"] = shift_id
    response = client.post("/api/v1/sync/offline-sales", json={"sales": [item]})
    assert response.status_code == 200, response.text
    return response.json()["results"][0]


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


def test_offline_synced_sale_without_shift_id_excluded_from_current_shift():
    """Backward compat: queue items from pre-shift_id bundles sync unattributed.

    A sync item without shift_id must keep today's behavior exactly — the sale
    lands, but never inflates the current drawer.
    """
    client = _new_client("Offline Sync Shift")
    product = _create_product(client, name="Concha", price="50.00")
    shift = _open_shift(client, opening="100.00")

    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
    )
    assert result["status"] == "synced"

    # Legacy offline sale is NOT attributed to the current drawer, so expected
    # stays at the opening balance.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "100.00"

    closed = _close_shift(client, shift["id"], actual="100.00")
    assert closed["reconciliation_status"] == "balanced"


def test_register_path_sale_with_open_shift_counts_in_expected_cash():
    """The P0 proof: the real POS path (sync endpoint + ring-time shift_id)
    must count cash sales in the drawer's expected cash."""
    client = _new_client("Register Path Shift")
    product = _create_product(client, name="Cafe", price="50.00")
    shift = _open_shift(client, opening="100.00")

    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        shift_id=shift["id"],
    )
    assert result["status"] == "synced"

    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "150.00"

    closed = _close_shift(client, shift["id"], actual="150.00")
    assert closed["reconciliation_status"] == "balanced"
    assert closed["variance_amount"] == "0.00"


def test_register_path_split_payment_counts_only_cash_portion():
    client = _new_client("Register Split Shift")
    product = _create_product(client, name="Combo Sync", price="50.00")
    shift = _open_shift(client, opening="100.00")

    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[
            {"method": "cash", "amount": "30.00", "amount_tendered": "30.00"},
            {"method": "bank_transfer", "amount": "20.00"},
        ],
        shift_id=shift["id"],
    )
    assert result["status"] == "synced"

    closed = _close_shift(client, shift["id"], actual="130.00")
    assert closed["reconciliation_status"] == "balanced"


def test_sync_to_closed_shift_keeps_frozen_close_and_current_drawer():
    """A sale rung in shift A but synced after A closed attributes to A as the
    historical record, without changing A's frozen reconciliation nor shift B's
    live expected cash."""
    client = _new_client("Late Sync Shift")
    product = _create_product(client, name="Pan", price="50.00")

    shift_a = _open_shift(client, opening="100.00")
    closed_a = _close_shift(client, shift_a["id"], actual="100.00")
    assert closed_a["expected_cash_amount"] == "100.00"

    shift_b = _open_shift(client, opening="200.00")

    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        shift_id=shift_a["id"],
    )
    assert result["status"] == "synced"

    # Shift A keeps its frozen close-time expected cash.
    detail_a = client.get(f"/api/v1/shifts/{shift_a['id']}").json()
    assert detail_a["expected_cash_amount"] == "100.00"

    # Shift B's drawer is untouched by the late sync.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "200.00"

    closed_b = _close_shift(client, shift_b["id"], actual="200.00")
    assert closed_b["reconciliation_status"] == "balanced"


def test_sync_with_unknown_or_foreign_shift_id_degrades_to_unattributed():
    """Attribution metadata never fails a sale, and a shift id from another
    tenant must not attach (tenant isolation)."""
    client = _new_client("Foreign Shift A")
    other = _new_client("Foreign Shift B")
    other_shift = _open_shift(other, opening="500.00")

    product = _create_product(client, name="Galleta", price="50.00")
    shift = _open_shift(client, opening="100.00")

    # Unknown shift id: sale syncs, drawer untouched.
    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        shift_id=str(uuid4()),
    )
    assert result["status"] == "synced"

    # Foreign tenant's shift id: sale syncs, neither drawer is affected.
    result = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        shift_id=other_shift["id"],
    )
    assert result["status"] == "synced"

    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "100.00"

    other_current = other.get("/api/v1/shifts/current").json()
    assert other_current["expected_cash_amount"] == "500.00"

    closed = _close_shift(client, shift["id"], actual="100.00")
    assert closed["reconciliation_status"] == "balanced"


def test_sync_replay_with_or_without_shift_id_is_idempotent():
    """shift_id stays out of the idempotency payload hash: a replay of a
    pre-deploy queue item that now carries shift_id must return the same order
    instead of failing with 'Idempotency key reused', and the cash counts once.
    """
    client = _new_client("Idempotent Sync Shift")
    product = _create_product(client, name="Tamal", price="50.00")
    shift = _open_shift(client, opening="100.00")
    client_uuid = str(uuid4())

    first = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        client_uuid=client_uuid,
    )
    assert first["status"] == "synced"

    # Replay of the same client_uuid, now carrying shift_id (e.g. after a PWA
    # bundle update): same order, no new attribution, no 400.
    replay = _sync_sale(
        client,
        product_id=product["id"],
        payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}],
        client_uuid=client_uuid,
        shift_id=shift["id"],
    )
    assert replay["status"] == "synced"
    assert replay["order_id"] == first["order_id"]

    # First sync had no shift_id, so the stored order stays unattributed and
    # the drawer counts nothing — exactly once-and-only-once semantics.
    current = client.get("/api/v1/shifts/current").json()
    assert current["expected_cash_amount"] == "100.00"


def test_cash_sale_without_open_shift_rejected():
    """Product decision (jun-2026): cash must land in an open drawer so the
    corte always reconciles. Replaces the old contract where a cash sale
    without a shift silently recorded unattributed — expected behavior changed
    deliberately, mirroring the existing cash-refund rule."""
    client = _new_client("No Shift Cash Sale")
    product = _create_product(client, name="Te", price="25.00")

    response = _post_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "cash", "amount": "25.00", "amount_tendered": "25.00"}],
    )
    assert response.status_code == 400, response.text
    assert "Open a shift before accepting cash payments" in response.text


def test_card_sale_without_open_shift_succeeds():
    """Non-cash methods don't touch the drawer, so they stay allowed without
    an open shift (recorded unattributed)."""
    client = _new_client("No Shift Card Sale")
    product = _create_product(client, name="Te Verde", price="25.00")

    order = _create_order(
        client,
        items=[{"product_id": product["id"], "quantity": 1}],
        payments=[{"method": "bank_transfer", "amount": "25.00"}],
    )
    assert order["status"] == "completed"

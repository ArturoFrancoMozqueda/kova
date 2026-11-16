from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import set_tenant_context
from app.orders import service
from app.orders.models import Refund
from app.orders.schemas import RefundCreate
from app.shifts.models import CashMovement
from app.tests.test_refund_method_validation import (
    _create_product,
    _open_shift,
    _order,
    _signup_verify_login,
)
from app.tests.test_shift_cash_integrity import (
    _cleanup_concurrent_drawer,
    _seed_concurrent_drawer,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _sale(client):
    _signup_verify_login(client, f"reconcile-{uuid4().hex}@example.com", "Reconcile")
    _open_shift(client)
    product = _create_product(client, name="Pastel", price="25.00")
    order = _order(client, items=[{"product_id": product["id"], "quantity": 2}],
                   payments=[{"method": "cash", "amount": "50.00", "amount_tendered": "50.00"}])
    payload = {"reason": "customer_return", "refund_payment_method": "cash",
               "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}]}
    return order, payload


def test_cancel_missing_refund_fences_late_original_and_allows_new_intent(client):
    order, payload = _sale(client)
    url = f"/api/v1/orders/{order['id']}/refunds"
    headers = {"Idempotency-Key": str(uuid4())}
    cancelled = client.post(f"{url}/reconcile", headers=headers, json=payload)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json() == {"status": "cancelled", "refund": None}
    assert client.post(url, headers=headers, json=payload).status_code == 409
    assert client.get(url).json() == []
    repeated = client.post(f"{url}/reconcile", headers=headers, json=payload)
    assert repeated.json() == cancelled.json()
    fresh = client.post(url, headers={"Idempotency-Key": str(uuid4())}, json=payload)
    assert fresh.status_code == 201, fresh.text
    assert len(client.get(url).json()) == 1


def test_reconciliation_recovers_confirmed_result_without_second_refund(client, db):
    order, payload = _sale(client)
    url = f"/api/v1/orders/{order['id']}/refunds"
    headers = {"Idempotency-Key": str(uuid4())}
    original = client.post(url, headers=headers, json=payload)
    assert original.status_code == 201, original.text
    changed = {**payload, "items": [{**payload["items"][0], "quantity": 2}]}
    mismatch = client.post(f"{url}/reconcile", headers=headers, json=changed)
    assert mismatch.status_code == 400, mismatch.text
    db.rollback()
    recovered = client.post(f"{url}/reconcile", headers=headers, json=payload)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json() == {"status": "confirmed", "refund": original.json()}
    assert len(client.get(url).json()) == 1


def test_other_tenant_cannot_reconcile_a_refund_or_change_its_key(client, db):
    order, payload = _sale(client)
    url = f"/api/v1/orders/{order['id']}/refunds"
    headers = {"Idempotency-Key": str(uuid4())}
    original = client.post(url, headers=headers, json=payload)
    assert original.status_code == 201, original.text
    other = TestClient(client.app)
    _signup_verify_login(other, f"other-reconcile-{uuid4().hex}@example.com", "Other tenant")
    denied = other.post(f"{url}/reconcile", headers=headers, json=payload)
    assert denied.status_code == 404, denied.text
    db.rollback()
    recovered = client.post(f"{url}/reconcile", headers=headers, json=payload)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json() == {"status": "confirmed", "refund": original.json()}


def test_reconciliation_cancels_invalid_prior_attempt_before_correction(client, db):
    order, payload = _sale(client)
    url = f"/api/v1/orders/{order['id']}/refunds"
    headers = {"Idempotency-Key": str(uuid4())}
    invalid = {**payload, "items": [{**payload["items"][0], "quantity": 3}]}
    assert client.post(url, headers=headers, json=invalid).status_code == 422
    # Production closes its request-local session (rolling back the reservation)
    # after a rejected write. The API fixture reuses a session between requests.
    db.rollback()
    cancelled = client.post(f"{url}/reconcile", headers=headers, json=invalid)
    assert cancelled.json()["status"] == "cancelled"
    assert client.post(url, headers=headers, json=invalid).status_code == 409
    corrected = client.post(url, headers={"Idempotency-Key": str(uuid4())}, json=payload)
    assert corrected.status_code == 201, corrected.text


@pytest.mark.parametrize("cancel_wins", [False, True])
def test_reconciliation_serializes_with_inflight_original(
    owner_engine, kova_app_engine, monkeypatch, cancel_wins,
):
    context = _seed_concurrent_drawer(owner_engine, existing_sale=True)
    tenant, user, order = (context[key] for key in ("tenant_id", "user_id", "order_id"))
    body = RefundCreate.model_validate({
        "reason": "customer_return", "refund_payment_method": "cash",
        "items": [{"order_item_id": context["order_item_id"], "quantity": 1}],
    })
    key = str(uuid4())
    first_claimed, second_started, release_first = Event(), Event(), Event()
    original_claim = service._stored_response

    def pause_first_claim(*args, **kwargs):
        if first_claimed.is_set():
            second_started.set()
            return original_claim(*args, **kwargs)
        result = original_claim(*args, **kwargs)
        first_claimed.set()
        assert release_first.wait(timeout=5)
        return result

    monkeypatch.setattr(service, "_stored_response", pause_first_claim)

    def run(cancel):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            function = service.reconcile_refund if cancel else service.create_refund
            try:
                return function(db, tenant_id=tenant, user_id=user, order_id=order,
                                body=body, idempotency_key=key)
            except HTTPException as exc:
                return exc.status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(run, cancel_wins)
            assert first_claimed.wait(timeout=5)
            second = executor.submit(run, not cancel_wins)
            assert second_started.wait(timeout=5)
            try:
                with pytest.raises(TimeoutError):
                    second.result(timeout=0.1)
            finally:
                release_first.set()
            first_result, second_result = first.result(timeout=5), second.result(timeout=5)
        if cancel_wins:
            assert first_result == {"status": "cancelled", "refund": None}
            assert second_result == 409
        else:
            assert first_result[0] == 201
            assert second_result["status"] == "confirmed"
            assert second_result["refund"] == first_result[1]
        with Session(owner_engine) as check:
            expected = 0 if cancel_wins else 1
            assert check.query(Refund).filter_by(tenant_id=tenant).count() == expected
            assert check.query(CashMovement).filter_by(
                tenant_id=tenant, type="refund_payout"
            ).count() == expected
    finally:
        release_first.set()
        _cleanup_concurrent_drawer(owner_engine, tenant_id=tenant, user_id=user)

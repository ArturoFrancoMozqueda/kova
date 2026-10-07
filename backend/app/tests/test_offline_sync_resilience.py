"""PLAN-03 offline-sync integrity: batch resilience, concurrent-duplicate
replay, ring-time (occurred_at) preservation, and clock-skew clamping."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.orders.service import _clamp_occurred_at

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
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


def _create_product(client: TestClient, *, name: str = "Resilient Concha") -> dict:
    response = client.post(
        "/api/v1/catalog/products",
        headers={"Idempotency-Key": f"resilience-product-{name}"},
        json={"name": name, "price_amount": "18.50"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _sale(client_uuid: str, product_id: str, *, occurred_at: str | None = None) -> dict:
    item: dict = {
        "client_uuid": client_uuid,
        "order": {
            "items": [{"product_id": product_id, "quantity": 2}],
            "payments": [{"method": "cash", "amount": "37.00", "amount_tendered": "40.00"}],
        },
    }
    if occurred_at is not None:
        item["occurred_at"] = occurred_at
    return item


# ── Clamp unit tests ──────────────────────────────────────────────────────────


def test_clamp_none_defaults_to_now():
    before = datetime.now(UTC)
    result = _clamp_occurred_at(None)
    assert before <= result <= datetime.now(UTC)


def test_clamp_preserves_recent_past():
    ts = datetime.now(UTC) - timedelta(hours=6)
    assert _clamp_occurred_at(ts) == ts


def test_clamp_rejects_absurd_future():
    ts = datetime.now(UTC) + timedelta(days=3)
    result = _clamp_occurred_at(ts)
    assert result < ts
    assert result <= datetime.now(UTC) + timedelta(seconds=1)


def test_clamp_rejects_far_past():
    ts = datetime.now(UTC) - timedelta(days=400)
    result = _clamp_occurred_at(ts)
    assert result > ts


def test_clamp_normalizes_naive_to_utc():
    naive = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
    result = _clamp_occurred_at(naive)
    assert result.tzinfo is not None


# ── Batch resilience ──────────────────────────────────────────────────────────


def test_non_http_error_isolates_to_single_sale(client, monkeypatch):
    """A non-HTTP exception in one sale must not 500 the batch or dead-letter
    the good sales."""
    _signup_verify_login(client, "resilience-batch@example.com", "Batch Bakery")
    product = _create_product(client)

    good_uuid = str(uuid4())
    bad_uuid = str(uuid4())

    from app.orders import service as order_service

    real_create = order_service.create_order

    def flaky_create(*args, **kwargs):
        if str(kwargs.get("client_uuid")) == bad_uuid:
            raise RuntimeError("simulated non-HTTP failure")
        return real_create(*args, **kwargs)

    monkeypatch.setattr("app.sync.service.order_service.create_order", flaky_create)

    response = client.post(
        "/api/v1/sync/offline-sales",
        json={
            "sales": [
                _sale(good_uuid, product["id"]),
                _sale(bad_uuid, product["id"]),
            ]
        },
    )

    assert response.status_code == 200, response.text
    results = {r["client_uuid"]: r for r in response.json()["results"]}
    assert results[good_uuid]["status"] == "synced"
    assert results[good_uuid]["order_id"] is not None
    assert results[bad_uuid]["status"] == "failed"
    assert "RuntimeError" in results[bad_uuid]["error"]


def test_concurrent_duplicate_resolves_to_single_order(client, monkeypatch):
    """An IntegrityError from a racing same-client_uuid INSERT must resolve to
    the one committed order and report synced — never a false dead-letter."""
    _signup_verify_login(client, "resilience-race@example.com", "Race Bakery")
    product = _create_product(client, name="Race Concha")
    client_uuid = str(uuid4())
    payload = _sale(client_uuid, product["id"])

    first = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})
    assert first.status_code == 200, first.text
    order_id = first.json()["results"][0]["order_id"]
    assert order_id is not None

    # Simulate a concurrent racer that lost the INSERT: create_order raises the
    # unique-constraint IntegrityError even though the order already exists.
    def racer(*args, **kwargs):
        raise IntegrityError("INSERT", {}, Exception("duplicate client_uuid"))

    monkeypatch.setattr("app.sync.service.order_service.create_order", racer)

    second = client.post("/api/v1/sync/offline-sales", json={"sales": [payload]})
    assert second.status_code == 200, second.text
    result = second.json()["results"][0]
    assert result["status"] == "synced"
    assert result["order_id"] == order_id


# ── Ring-time (occurred_at) preservation ──────────────────────────────────────


def test_offline_sale_reports_on_ring_time_day_not_sync_day(client):
    """A sale rung yesterday but synced today must appear in yesterday's sales
    summary (ring-time), not today's (sync-time)."""
    _signup_verify_login(client, "resilience-time@example.com", "Cross Midnight Bakery")
    product = _create_product(client, name="Midnight Concha")

    # Ring-time: 8 days ago at 23:50 America/Mexico_City (UTC-6) → within the
    # clamp window, so it is preserved verbatim.
    ring_day = (datetime.now(UTC) - timedelta(days=8)).date()
    occurred_at = f"{ring_day.isoformat()}T23:50:00-06:00"

    response = client.post(
        "/api/v1/sync/offline-sales",
        json={"sales": [_sale(str(uuid4()), product["id"], occurred_at=occurred_at)]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["status"] == "synced"

    ring_summary = client.get(
        "/api/v1/reports/sales-summary",
        params={"start_date": ring_day.isoformat(), "end_date": ring_day.isoformat()},
    )
    assert ring_summary.status_code == 200, ring_summary.text
    assert ring_summary.json()["order_count"] == 1

    # The sync day (today) must NOT contain the sale.
    today = datetime.now(UTC).date().isoformat()
    sync_summary = client.get(
        "/api/v1/reports/sales-summary",
        params={"start_date": today, "end_date": today},
    )
    assert sync_summary.status_code == 200, sync_summary.text
    assert sync_summary.json()["order_count"] == 0


def test_future_occurred_at_is_clamped_into_current_window(client):
    """A client sending an absurd future ring-time cannot push the sale into a
    future report; it is clamped to server-now."""
    _signup_verify_login(client, "resilience-future@example.com", "Future Bakery")
    product = _create_product(client, name="Future Concha")

    future = (datetime.now(UTC) + timedelta(days=10)).replace(microsecond=0)
    response = client.post(
        "/api/v1/sync/offline-sales",
        json={"sales": [_sale(str(uuid4()), product["id"], occurred_at=future.isoformat())]},
    )
    assert response.status_code == 200, response.text
    order_id = response.json()["results"][0]["order_id"]

    # The receipt's timestamp (ring-time) must be clamped to ~now, not 10 days out.
    receipt = client.get(f"/api/v1/orders/{order_id}/receipt")
    assert receipt.status_code == 200, receipt.text
    receipt_time = datetime.fromisoformat(receipt.json()["created_at"])
    assert receipt_time < future

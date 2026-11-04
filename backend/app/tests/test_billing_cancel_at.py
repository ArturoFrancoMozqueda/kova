"""Stripe's period-end cancellation representations share one public semantic flag."""

import copy
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.billing import service
from app.billing.access import get_billing_access_status
from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.tests.test_billing_api import (
    _configure_stripe,
    _signup_verify_login,
    _stripe_event,
    _stripe_signature,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("kind", ["legacy", "timestamp", "none", "zero", "bool", "string", "float",
                                 "past", "other_future", "overflow", "missing_period"])
def test_only_explicit_flag_or_exact_future_period_timestamp_is_scheduled(nested, kind):
    future = int((datetime.now(UTC) + timedelta(days=30)).timestamp())
    value = {"legacy": None, "timestamp": future, "none": None, "zero": 0, "bool": True,
             "string": str(future), "float": float(future), "past": 1,
             "other_future": future + 86400, "overflow": 10**100,
             "missing_period": future}[kind]
    end = 1 if kind == "past" else (10**100 if kind == "overflow" else future)
    source = {"cancel_at_period_end": kind == "legacy", "cancel_at": value}
    if kind != "missing_period":
        if nested:
            source["items"] = {"data": [{"current_period_end": end}]}
        else:
            source["current_period_end"] = end
    assert service._scheduled_cancellation_at_period_end(source) is (kind in {"legacy", "timestamp"})
    # canceled_at identifies a request in some Stripe flows; it is never the scheduled end.
    assert service._scheduled_cancellation_at_period_end({
        "cancel_at_period_end": False, "canceled_at": future, "current_period_end": future,
    }) is False


def test_legacy_partial_boolean_response_remains_supported():
    assert service._scheduled_cancellation_at_period_end({"cancel_at_period_end": True}) is True
    for value in [False, None, 0, 1, "true", "false"]:
        assert service._scheduled_cancellation_at_period_end({"cancel_at_period_end": value}) is False


@pytest.fixture
def owned_subscription(client, db, monkeypatch):
    _configure_stripe(monkeypatch)
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    signup = _signup_verify_login(client, f"cancel-at-{uuid4().hex}@example.com", "Cancellation")
    now = datetime.now(UTC).replace(microsecond=0)
    row = Subscription(
        tenant_id=UUID(signup["tenant_id"]), stripe_customer_id="cus_cancel_at",
        stripe_subscription_id="sub_cancel_at", stripe_price_id="price_standard_299_mxn",
        status="active", current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=29), stripe_period_synced_at=now,
    )
    db.add(row)
    db.commit()
    source = {
        "id": row.stripe_subscription_id, "object": "subscription", "customer": row.stripe_customer_id,
        "livemode": False,
        "status": "active", "cancel_at_period_end": False, "cancel_at": None, "canceled_at": None,
        "current_period_start": int(row.current_period_start.timestamp()),
        "current_period_end": int(row.current_period_end.timestamp()),
        "items": {"data": [{"quantity": 1, "price": {
            "id": row.stripe_price_id, "unit_amount": 29900, "currency": "mxn",
        }}]},
    }
    # Every test uses an explicit synthetic provider response; never a real network lookup.
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_kwargs: copy.deepcopy(source))
    return row, source


def _deliver(client, source, *, created):
    payload = _stripe_event("customer.subscription.updated", source, created=created)
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload)})
    assert response.status_code == 200, response.text
    return payload


@pytest.mark.parametrize("nested", [False, True])
def test_signed_portal_timestamp_exposes_scheduled_cancel_without_changing_paid_access(
    client, db, owned_subscription, nested,
):
    row, source = owned_subscription
    end = source["current_period_end"]
    source.update(cancel_at=end, canceled_at=int(datetime.now(UTC).timestamp()))
    if nested:
        source["items"]["data"][0].update(current_period_start=source.pop("current_period_start"),
                                          current_period_end=source.pop("current_period_end"))
    before = (row.status, row.plan_code, row.stripe_price_id, row.amount_minor_units, row.currency,
              row.current_period_end, row.plan_effective_until, row.past_due_at,
              row.grace_period_ends_at)
    payload = _deliver(client, source, created=int(datetime.now(UTC).timestamp()) - 10)
    assert client.post("/api/v1/billing/webhooks/stripe", content=payload,
                       headers={"Stripe-Signature": _stripe_signature(payload)}).status_code == 200
    response = client.get("/api/v1/billing/subscription")
    assert response.status_code == 200
    assert response.json()["subscription"]["cancel_at_period_end"] is True
    assert response.json()["subscription"]["period_freshness"] == "verified"
    assert response.json()["access"]["allowed"] is True
    db.refresh(row)
    assert row.cancel_at_period_end is True
    assert row.canceled_at < row.current_period_end
    assert (row.status, row.plan_code, row.stripe_price_id, row.amount_minor_units, row.currency,
            row.current_period_end, row.plan_effective_until, row.past_due_at,
            row.grace_period_ends_at) == before
    assert db.query(WebhookEvent).filter_by(stripe_event_id=json.loads(payload)["id"]).count() == 1


def test_resume_rejects_old_or_duplicate_scheduled_cancellation(client, db, owned_subscription):
    row, source = owned_subscription
    created = int(datetime.now(UTC).timestamp()) - 30
    source["cancel_at"] = source["current_period_end"]
    scheduled = _deliver(client, source, created=created)
    source["cancel_at"] = None
    resumed = _deliver(client, source, created=created + 1)
    source["cancel_at"] = source["current_period_end"]
    stale = _deliver(client, source, created=created - 1)
    for payload in [scheduled, resumed]:
        assert client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload)}).status_code == 200
    db.refresh(row)
    assert row.cancel_at_period_end is False
    assert row.status == "active"
    assert row.stripe_lifecycle_event_id == json.loads(resumed)["id"]
    assert db.query(WebhookEvent).filter_by(stripe_event_id=json.loads(stale)["id"]).one().error_reason == "stale_lifecycle_event"


def test_authoritative_status_refresh_normalizes_cancel_and_resume(client, db, owned_subscription):
    row, source = owned_subscription
    for cancel, expected in [(source["current_period_end"], True), (None, False)]:
        source["cancel_at"] = cancel
        row.stripe_period_synced_at = datetime.now(UTC) - timedelta(days=2)
        db.commit()
        response = client.get("/api/v1/billing/subscription")
        assert response.status_code == 200
        assert response.json()["subscription"]["cancel_at_period_end"] is expected
        assert response.json()["access"]["allowed"] is True


def test_cancel_api_accepts_full_timestamp_response_and_retains_idempotence(
    client, db, owned_subscription, monkeypatch,
):
    row, source = owned_subscription
    source["cancel_at"] = source["current_period_end"]
    calls = []
    monkeypatch.setattr(service.subscription_client, "update_cancel_at_period_end",
                        lambda **kwargs: calls.append(kwargs) or copy.deepcopy(source))
    for _ in range(2):
        response = client.post("/api/v1/billing/cancel")
        assert response.status_code == 200
        assert response.json()["subscription"]["cancel_at_period_end"] is True
        assert response.json()["access"]["allowed"] is True
    assert len(calls) == 1


def test_timestamp_never_substitutes_webhook_signature_or_clears_debt(
    client, db, owned_subscription,
):
    row, source = owned_subscription
    source["cancel_at"] = source["current_period_end"]
    payload = _stripe_event("customer.subscription.updated", source)
    assert client.post("/api/v1/billing/webhooks/stripe", content=payload,
                       headers={"Stripe-Signature": "t=1,v1=invalid"}).status_code == 400
    db.refresh(row)
    assert row.cancel_at_period_end is False
    row.status = source["status"] = "past_due"
    row.past_due_at = datetime.now(UTC) - timedelta(days=3)
    row.grace_period_ends_at = row.past_due_at + timedelta(hours=48)
    db.commit()
    debt = (row.past_due_at, row.grace_period_ends_at)
    _deliver(client, source, created=int(datetime.now(UTC).timestamp()))
    db.refresh(row)
    assert row.cancel_at_period_end is True
    assert row.status == "past_due"
    assert (row.past_due_at, row.grace_period_ends_at) == debt
    assert get_billing_access_status(db, tenant_id=row.tenant_id).allowed is False

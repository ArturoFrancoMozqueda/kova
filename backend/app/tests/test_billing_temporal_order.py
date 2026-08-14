import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.billing import service
from app.billing.models import Subscription, WebhookEvent
from app.billing.stripe_client import StripeSubscriptionError
from app.config import settings
from app.tenants.models import Tenant


def _event(event_id: str, event_type: str, created: int | None, stripe_object: dict) -> bytes:
    payload = {"id": event_id, "type": event_type, "data": {"object": stripe_object}}
    if created is not None:
        payload["created"] = created
    return json.dumps(payload, separators=(",", ":")).encode()


def _subscription_object(subscription_id: str, status: str) -> dict:
    return {
        "id": subscription_id,
        "object": "subscription",
        "status": status,
        "current_period_start": 1_900_000_000,
        "current_period_end": 1_902_592_000,
        "metadata": {},
    }


@pytest.fixture
def temporal_subscription(db: Session, monkeypatch) -> Subscription:
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **_kwargs: None)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    tenant = Tenant(name="Temporal Billing", slug=f"temporal-{uuid4().hex}")
    db.add(tenant)
    db.flush()
    subscription = Subscription(
        tenant_id=tenant.id,
        stripe_subscription_id=f"sub_{uuid4().hex}",
        status="incomplete",
    )
    db.add(subscription)
    db.commit()
    return subscription


def _process(db: Session, payload: bytes) -> dict:
    return service.process_stripe_webhook(db, payload=payload, signature_header="unused")


def test_older_subscription_event_cannot_cancel_newer_active_state(
    db: Session, temporal_subscription: Subscription
) -> None:
    subscription_id = temporal_subscription.stripe_subscription_id or ""
    newer = _event(
        "evt_active_new",
        "customer.subscription.updated",
        200,
        _subscription_object(subscription_id, "active"),
    )
    older = _event(
        "evt_cancel_old",
        "customer.subscription.deleted",
        100,
        _subscription_object(subscription_id, "canceled"),
    )

    assert _process(db, newer) == {"status": "processed"}
    assert _process(db, older) == {"status": "ignored"}
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "active"
    stale = db.query(WebhookEvent).filter_by(stripe_event_id="evt_cancel_old").one()
    assert stale.error_reason == "stale_lifecycle_event"


def test_older_payment_failure_cannot_override_newer_success(
    db: Session, temporal_subscription: Subscription, monkeypatch
) -> None:
    temporal_subscription.status = "past_due"
    db.commit()
    receipts: list[str] = []
    monkeypatch.setattr(
        service,
        "_send_payment_receipt_for_tenant",
        lambda *_args, **_kwargs: receipts.append("sent"),
    )
    subscription_id = temporal_subscription.stripe_subscription_id or ""
    succeeded = _event(
        "evt_payment_new",
        "invoice.payment_succeeded",
        200,
        {"id": "in_new", "subscription": subscription_id, "metadata": {}},
    )
    failed = _event(
        "evt_payment_old",
        "invoice.payment_failed",
        100,
        {"id": "in_old", "subscription": subscription_id, "metadata": {}},
    )
    stale_success = _event(
        "evt_payment_stale_success",
        "invoice.payment_succeeded",
        100,
        {"id": "in_stale", "subscription": subscription_id, "metadata": {}},
    )

    _process(db, succeeded)
    _process(db, succeeded)
    _process(db, failed)
    _process(db, stale_success)
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "active"
    assert receipts == ["sent"]


@pytest.mark.parametrize("reverse", [False, True])
def test_deleted_wins_created_when_timestamps_tie(
    db: Session, temporal_subscription: Subscription, reverse: bool
) -> None:
    subscription_id = temporal_subscription.stripe_subscription_id or ""
    created = _event(
        f"evt_created_{reverse}",
        "customer.subscription.created",
        300,
        _subscription_object(subscription_id, "active"),
    )
    deleted = _event(
        f"evt_deleted_{reverse}",
        "customer.subscription.deleted",
        300,
        _subscription_object(subscription_id, "canceled"),
    )
    payloads = [deleted, created] if reverse else [created, deleted]

    for payload in payloads:
        _process(db, payload)
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "canceled"


def test_ambiguous_equal_rank_reconciles_to_authoritative_stripe_state(
    db: Session, temporal_subscription: Subscription, monkeypatch
) -> None:
    subscription_id = temporal_subscription.stripe_subscription_id or ""
    first = _event(
        "evt_update_a",
        "customer.subscription.updated",
        400,
        _subscription_object(subscription_id, "past_due"),
    )
    second = _event(
        "evt_update_b",
        "customer.subscription.updated",
        400,
        _subscription_object(subscription_id, "canceled"),
    )
    _process(db, first)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_temporal")
    monkeypatch.setattr(
        service.subscription_client,
        "retrieve",
        lambda **_kwargs: _subscription_object(subscription_id, "active"),
    )

    assert _process(db, second) == {"status": "processed"}
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "active"


def test_failed_ambiguous_reconciliation_is_retryable(
    db: Session, temporal_subscription: Subscription, monkeypatch
) -> None:
    temporal_subscription.stripe_lifecycle_watermark_at = datetime.fromtimestamp(500, tz=UTC)
    temporal_subscription.stripe_lifecycle_event_id = "evt_previous"
    temporal_subscription.stripe_lifecycle_event_type = "customer.subscription.updated"
    db.commit()
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_temporal")
    monkeypatch.setattr(
        service.subscription_client,
        "retrieve",
        lambda **_kwargs: (_ for _ in ()).throw(StripeSubscriptionError("temporary")),
    )
    payload = _event(
        "evt_ambiguous_retry",
        "customer.subscription.updated",
        None,
        _subscription_object(temporal_subscription.stripe_subscription_id or "", "canceled"),
    )

    with pytest.raises(StripeSubscriptionError):
        _process(db, payload)
    with pytest.raises(StripeSubscriptionError):
        _process(db, payload)
    event = db.query(WebhookEvent).filter_by(stripe_event_id="evt_ambiguous_retry").one()
    assert event.processing_status == "failed"
    assert event.process_attempts == 2
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "incomplete"


def test_internal_reconciliation_requires_internal_key(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "internal_api_key", "billing-internal")
    response = client.post("/api/v1/billing/internal/reconcile", json={"limit": 10})
    assert response.status_code == 403


def test_internal_reconciliation_converges_with_internal_key(
    client, db: Session, temporal_subscription: Subscription, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "internal_api_key", "billing-internal")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_temporal")
    monkeypatch.setattr(
        service.subscription_client,
        "retrieve",
        lambda **_kwargs: _subscription_object(
            temporal_subscription.stripe_subscription_id or "", "active"
        ),
    )

    response = client.post(
        "/api/v1/billing/internal/reconcile",
        json={"limit": 10},
        headers={"X-Internal-Key": "billing-internal"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["checked"] >= 1
    assert response.json()["updated"] >= 1
    db.refresh(temporal_subscription)
    assert temporal_subscription.status == "active"


def test_concurrent_replay_is_claimed_once(owner_engine, monkeypatch) -> None:
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **_kwargs: None)
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    tenant_id = uuid4()
    subscription_id = f"sub_{uuid4().hex}"
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrent Billing", slug=f"concurrent-{uuid4().hex}"))
        seed.flush()
        seed.add(
            Subscription(
                tenant_id=tenant_id,
                stripe_subscription_id=subscription_id,
                status="incomplete",
            )
        )
        seed.commit()
    payload = _event(
        f"evt_concurrent_{uuid4().hex}",
        "customer.subscription.updated",
        600,
        _subscription_object(subscription_id, "active"),
    )

    def worker() -> dict:
        with Session(owner_engine) as worker_db:
            return _process(worker_db, payload)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: worker(), range(2)))
        assert results == [{"status": "processed"}, {"status": "processed"}]
        with Session(owner_engine) as check:
            event_id = json.loads(payload)["id"]
            assert check.query(WebhookEvent).filter_by(stripe_event_id=event_id).count() == 1
            assert (
                check.query(AuditLog)
                .filter_by(tenant_id=tenant_id, action="billing.subscription_status_updated")
                .count()
                == 1
            )
    finally:
        with Session(owner_engine) as cleanup:
            cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(WebhookEvent).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Subscription).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Tenant).filter_by(id=tenant_id).delete()
            cleanup.commit()

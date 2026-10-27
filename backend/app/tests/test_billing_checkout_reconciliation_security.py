"""Checkout history cannot override current Stripe subscription entitlements."""

import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import User
from app.billing import service
from app.billing.models import Subscription, WebhookEvent
from app.billing.stripe_client import StripeSubscriptionError
from app.config import settings
from app.tenants.models import Tenant
from app.tests.test_billing_api import _configure_stripe, _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
PATH = "/api/v1/billing/checkout/reconcile"


def _live(tenant_id, status="active", *, subscription_id="sub_current", created=200):
    return {
        "id": subscription_id, "object": "subscription", "customer": "cus_current",
        "status": status, "livemode": False, "created": created,
        "metadata": {"tenant_id": str(tenant_id)},
        # These scenarios model a paid current period. Expired and missing
        # periods have separate commercial-policy regressions.
        "current_period_start": int(datetime.now(UTC).timestamp()),
        "current_period_end": int((datetime.now(UTC) + timedelta(days=30)).timestamp()),
        "cancel_at_period_end": False, "canceled_at": None,
    }


@pytest.fixture
def recovery(client, db, monkeypatch):
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(client, f"reconcile-security-{uuid4().hex}@example.com", "Recovery")
    tenant_id = UUID(signup["tenant_id"])
    row = Subscription(
        tenant_id=tenant_id, stripe_subscription_id="sub_current",
        stripe_customer_id="cus_current", status="canceled",
        stripe_lifecycle_watermark_at=datetime.fromtimestamp(100, UTC),
        stripe_lifecycle_event_id="evt_existing", stripe_lifecycle_event_type="customer.subscription.deleted",
    )
    db.add(row)
    db.commit()
    checkout = {
        "id": "cs_history", "object": "checkout.session", "mode": "subscription",
        "livemode": False, "status": "complete", "payment_status": "paid",
        "customer": "cus_current", "subscription": "sub_current",
        "metadata": {"tenant_id": str(tenant_id)},
    }
    objects = {"sub_current": _live(tenant_id)}
    calls = []

    def retrieve(**kwargs):
        calls.append(kwargs["stripe_subscription_id"])
        value = objects[kwargs["stripe_subscription_id"]]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)

    monkeypatch.setattr(service.checkout_client, "retrieve_session", lambda **kwargs: copy.deepcopy(checkout))
    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    monkeypatch.setattr(service, "_send_welcome_email_for_tenant", lambda *a, **k: None)
    return row, checkout, objects, calls


@pytest.mark.parametrize("status", ["canceled", "unpaid", "incomplete", "incomplete_expired", "past_due"])
def test_historical_paid_checkout_keeps_current_blocked_state(client, db, recovery, status):
    row, _, objects, _ = recovery
    row.status = status
    row.past_due_at = datetime.now(UTC) - timedelta(days=30)
    row.grace_period_ends_at = row.past_due_at + timedelta(hours=48)
    old_grace = row.grace_period_ends_at
    db.commit()
    objects["sub_current"]["status"] = status

    response = client.post(PATH, json={"checkout_session_id": "cs_history"})

    assert response.status_code == 200, response.text
    assert response.json()["subscription"]["status"] == status
    assert response.json()["access"]["allowed"] is False
    db.refresh(row)
    assert row.grace_period_ends_at == old_grace
    assert row.stripe_lifecycle_watermark_at == datetime.fromtimestamp(100, UTC)
    assert db.query(AuditLog).filter_by(tenant_id=row.tenant_id, action="billing.subscription_activated").count() == 0


def test_complete_unpaid_checkout_does_not_infer_activation(client, recovery):
    _, checkout, objects, _ = recovery
    checkout["payment_status"] = "unpaid"
    objects["sub_current"]["status"] = "incomplete"
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code == 200
    assert response.json()["subscription"]["status"] == "incomplete"
    assert response.json()["access"]["allowed"] is False


@pytest.mark.parametrize("status", ["active", "trialing", "past_due"])
def test_recovery_preserves_authoritative_active_trial_and_grace(client, db, recovery, status):
    row, checkout, objects, _ = recovery
    objects["sub_current"].update(status=status, cancel_at_period_end=True, trial_end=2_000_000_000)
    if status == "trialing":
        checkout["payment_status"] = "no_payment_required"
    if status == "past_due":
        row.past_due_at = datetime.now(UTC) - timedelta(days=1)
        row.grace_period_ends_at = row.past_due_at + timedelta(hours=48)
        db.commit()
    old_grace = row.grace_period_ends_at
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["subscription"]["status"] == status
    assert body["subscription"]["cancel_at_period_end"] is True
    assert body["access"]["allowed"] is True
    if status == "trialing":
        assert body["subscription"]["trial_ends_at"] is not None
    if status == "past_due":
        db.refresh(row)
        assert row.grace_period_ends_at == old_grace


@pytest.mark.parametrize("problem", [
    "checkout_mode", "session_id", "checkout_customer", "subscription_customer",
    "subscription_tenant", "subscription_id", "subscription_mode", "missing_mode",
])
def test_checkout_and_current_subscription_must_match_identity(client, db, recovery, problem):
    row, checkout, objects, _ = recovery
    live = objects["sub_current"]
    if problem == "checkout_mode":
        checkout["mode"] = "payment"
    elif problem == "session_id":
        checkout["id"] = "cs_different"
    elif problem == "checkout_customer":
        checkout["customer"] = "cus_foreign"
    elif problem == "subscription_customer":
        live["customer"] = "cus_foreign"
    elif problem == "subscription_tenant":
        live["metadata"]["tenant_id"] = str(uuid4())
    elif problem == "subscription_id":
        live["id"] = "sub_foreign"
    elif problem == "subscription_mode":
        live["livemode"] = True
    else:
        live.pop("livemode")
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code in {400, 403, 503}, response.text
    db.refresh(row)
    assert row.status == "canceled"
    assert row.stripe_lifecycle_event_id == "evt_existing"


@pytest.mark.parametrize("source", ["key", "checkout", "subscription"])
def test_live_production_recovery_rejects_test_mode(client, db, recovery, monkeypatch, source):
    row, checkout, objects, _ = recovery
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_live_synthetic")  # gitleaks:allow
    checkout["livemode"] = True
    objects["sub_current"]["livemode"] = True
    if source == "key":
        monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic")  # gitleaks:allow
    elif source == "checkout":
        checkout["livemode"] = False
    else:
        objects["sub_current"]["livemode"] = False
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code == 503, response.text
    db.refresh(row)
    assert row.status == "canceled"


def test_lookup_outage_never_activates_or_changes_watermarks(client, db, recovery):
    row, _, objects, _ = recovery
    objects["sub_current"] = StripeSubscriptionError("synthetic outage")
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code == 502
    db.refresh(row)
    assert row.status == "canceled"
    assert row.stripe_lifecycle_event_id == "evt_existing"
    assert row.stripe_lifecycle_watermark_at == datetime.fromtimestamp(100, UTC)


@pytest.mark.parametrize("previous_status,new_created,replaced", [
    ("canceled", 100, False), ("canceled", 200, False),
    ("active", 300, False), ("past_due", 300, False),
    ("canceled", 300, True), ("incomplete_expired", 300, True),
])
def test_only_new_subscription_after_terminated_one_can_replace_mapping(
    client, db, recovery, previous_status, new_created, replaced,
):
    row, checkout, objects, _ = recovery
    row.status = previous_status
    db.commit()
    objects["sub_current"].update(status=previous_status, created=200)
    checkout["subscription"] = "sub_another"
    objects["sub_another"] = _live(row.tenant_id, subscription_id="sub_another", created=new_created)
    response = client.post(PATH, json={"checkout_session_id": "cs_history"})
    assert response.status_code == 200, response.text
    db.refresh(row)
    assert row.stripe_subscription_id == ("sub_another" if replaced else "sub_current")
    assert row.status == ("active" if replaced else previous_status)


@pytest.mark.parametrize("event_type", ["customer.subscription.updated", "invoice.paid", "invoice.payment_failed"])
@pytest.mark.parametrize("created", [50, 100, 101])
def test_next_webhook_refreshes_reconciled_snapshot_for_all_event_families(
    client, db, recovery, monkeypatch, event_type, created,
):
    row, _, objects, calls = recovery
    objects["sub_current"]["status"] = "canceled"
    assert client.post(PATH, json={"checkout_session_id": "cs_history"}).status_code == 200
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    event_object = _live(row.tenant_id)
    if event_type.startswith("invoice."):
        event_object = {"id": "in_old", "subscription": "sub_current", "metadata": {}}
    payload = json.dumps({"id": f"evt_{uuid4().hex}", "type": event_type,
        "created": created, "data": {"object": event_object}}).encode()

    service.process_stripe_webhook(db, payload=payload, signature_header="synthetic")

    db.refresh(row)
    assert row.status == "canceled"
    assert calls == ["sub_current", "sub_current"]


def test_webhook_outage_after_recovery_keeps_blocked_status_retryable(client, db, recovery, monkeypatch):
    row, _, objects, _ = recovery
    objects["sub_current"]["status"] = "past_due"
    row.past_due_at = datetime.now(UTC) - timedelta(days=30)
    row.grace_period_ends_at = datetime.now(UTC) - timedelta(days=20)
    db.commit()
    assert client.post(PATH, json={"checkout_session_id": "cs_history"}).status_code == 200
    old_grace = row.grace_period_ends_at
    objects["sub_current"] = StripeSubscriptionError("synthetic outage")
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    event_id = f"evt_{uuid4().hex}"
    payload = json.dumps({"id": event_id, "type": "invoice.paid", "created": 101,
        "data": {"object": {"id": "in_retry", "subscription": "sub_current"}}}).encode()
    with pytest.raises(StripeSubscriptionError):
        service.process_stripe_webhook(db, payload=payload, signature_header="synthetic")
    db.refresh(row)
    assert row.status == "past_due" and row.grace_period_ends_at == old_grace
    assert db.query(WebhookEvent).filter_by(stripe_event_id=event_id).one().processing_status == "failed"


def test_obsolete_invoice_cannot_activate_new_subscription_after_marker_consumed(
    client, db, recovery, monkeypatch,
):
    row, _, objects, calls = recovery
    objects["sub_current"]["status"] = "canceled"
    assert client.post(PATH, json={"checkout_session_id": "cs_history"}).status_code == 200
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    lifecycle = {"id": f"evt_{uuid4().hex}", "type": "customer.subscription.updated", "created": 101,
        "data": {"object": objects["sub_current"]}}
    service.process_stripe_webhook(db, payload=json.dumps(lifecycle).encode(), signature_header="synthetic")
    db.refresh(row)
    assert not row.stripe_lifecycle_event_id.startswith("checkout-reconcile:")
    obsolete = {"id": f"evt_{uuid4().hex}", "type": "invoice.paid", "created": 2_000_000_000,
        "data": {"object": {"id": "in_obsolete", "subscription": "sub_previous",
            "metadata": {"tenant_id": str(row.tenant_id)}}}}

    result = service.process_stripe_webhook(db, payload=json.dumps(obsolete).encode(), signature_header="synthetic")

    assert result == {"status": "ignored"}
    db.refresh(row)
    assert row.status == "canceled" and row.stripe_subscription_id == "sub_current"
    assert calls == ["sub_current", "sub_current"]


@pytest.mark.parametrize("current_status,old_status", [("active", "canceled"), ("canceled", "active")])
@pytest.mark.parametrize("event_type", ["customer.subscription.updated", "customer.subscription.deleted"])
def test_old_lifecycle_cannot_replace_current_mapping_after_marker_consumed(
    client, db, recovery, monkeypatch, current_status, old_status, event_type,
):
    row, _, objects, _ = recovery
    objects["sub_current"]["status"] = current_status
    assert client.post(PATH, json={"checkout_session_id": "cs_history"}).status_code == 200
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    lifecycle = {"id": f"evt_{uuid4().hex}", "type": "customer.subscription.updated", "created": 101,
        "data": {"object": objects["sub_current"]}}
    service.process_stripe_webhook(db, payload=json.dumps(lifecycle).encode(), signature_header="synthetic")
    db.refresh(row)
    assert not row.stripe_lifecycle_event_id.startswith("checkout-reconcile:")
    objects["sub_previous"] = _live(row.tenant_id, old_status, subscription_id="sub_previous", created=100)
    obsolete = {"id": f"evt_{uuid4().hex}", "type": event_type, "created": 2_000_000_000,
        "data": {"object": objects["sub_previous"]}}

    result = service.process_stripe_webhook(db, payload=json.dumps(obsolete).encode(), signature_header="synthetic")

    assert result == {"status": "ignored"}
    db.refresh(row)
    assert row.status == current_status and row.stripe_subscription_id == "sub_current"


@pytest.mark.parametrize("current_status", ["active", "trialing", "canceled"])
def test_newer_subscription_webhook_replaces_terminated_mapping_from_current_stripe_state(
    db, recovery, monkeypatch, current_status,
):
    row, _, objects, _ = recovery
    objects["sub_current"]["status"] = "canceled"
    objects["sub_next"] = _live(row.tenant_id, current_status, subscription_id="sub_next", created=300)
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    raw_object = {**objects["sub_next"], "status": "active"}
    payload = {"id": f"evt_{uuid4().hex}", "type": "customer.subscription.created", "created": 301,
        "data": {"object": raw_object}}

    result = service.process_stripe_webhook(db, payload=json.dumps(payload).encode(), signature_header="synthetic")

    assert result == {"status": "processed"}
    db.refresh(row)
    assert row.status == current_status and row.stripe_subscription_id == "sub_next"


def test_internal_repair_refreshes_mapping_after_acquiring_tenant_lock(owner_engine, monkeypatch):
    """A mapping replaced after candidate enumeration must never be restored."""
    _configure_stripe(monkeypatch)
    tenant_id = uuid4()
    previous_id, current_id = f"sub_{uuid4().hex}", f"sub_{uuid4().hex}"
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Repair race", slug=f"repair-{tenant_id}"))
        seed.flush()
        seed.add(Subscription(tenant_id=tenant_id, stripe_subscription_id=previous_id, status="canceled"))
        seed.commit()
    real_lock = service.repository.lock_billing_tenant
    calls = []

    def replace_then_lock(session, *, tenant_id):
        with Session(owner_engine) as replacement:
            real_lock(replacement, tenant_id=tenant_id)
            row = service.repository.lock_subscription_by_tenant(replacement, tenant_id=tenant_id)
            row.stripe_subscription_id = current_id
            replacement.commit()
        real_lock(session, tenant_id=tenant_id)

    def retrieve(**kwargs):
        calls.append(kwargs["stripe_subscription_id"])
        return _live(tenant_id, "canceled", subscription_id=kwargs["stripe_subscription_id"])

    monkeypatch.setattr(service.repository, "lock_billing_tenant", replace_then_lock)
    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    try:
        with Session(owner_engine) as session:
            result = service.reconcile_subscriptions(session)
        assert result == {"checked": 1, "updated": 1, "failed": 0}
        assert calls == [current_id]
        with Session(owner_engine) as check:
            assert check.query(Subscription).filter_by(tenant_id=tenant_id).one().stripe_subscription_id == current_id
    finally:
        with Session(owner_engine) as cleanup:
            cleanup.query(Subscription).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Tenant).filter_by(id=tenant_id).delete()
            cleanup.commit()


def test_reconcile_and_webhook_serialize_authoritative_state(owner_engine, monkeypatch):
    """Independent PostgreSQL transactions: webhook waits for recovery's lock."""
    _configure_stripe(monkeypatch)
    tenant_id, user_id = uuid4(), uuid4()
    subscription_id, customer_id = f"sub_{uuid4().hex}", f"cus_{uuid4().hex}"
    live = _live(tenant_id, subscription_id=subscription_id)
    live["customer"] = customer_id
    checkout = {"id": "cs_concurrent", "object": "checkout.session", "mode": "subscription",
        "livemode": False, "status": "complete", "payment_status": "paid",
        "customer": customer_id, "subscription": subscription_id, "metadata": {"tenant_id": str(tenant_id)}}
    lookup_started, release_lookup = Event(), Event()
    lookups = []

    def retrieve(**kwargs):
        lookups.append(kwargs)
        if len(lookups) == 1:
            lookup_started.set()
            assert release_lookup.wait(10)
            return copy.deepcopy(live)
        return {**live, "status": "canceled"}

    monkeypatch.setattr(service.checkout_client, "retrieve_session", lambda **kwargs: checkout)
    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kwargs: None)
    monkeypatch.setattr(service, "_send_welcome_email_for_tenant", lambda *a, **k: None)
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrent Recovery", slug=f"recovery-{tenant_id}"))
        seed.add(User(id=user_id, email=f"recovery-{user_id}@example.com", hashed_password="unused",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
        seed.flush()
        seed.add(Subscription(tenant_id=tenant_id, stripe_subscription_id=subscription_id,
            stripe_customer_id=customer_id, status="canceled"))
        seed.commit()
    event_id = f"evt_{uuid4().hex}"
    payload = json.dumps({"id": event_id, "type": "customer.subscription.updated", "created": 100,
        "data": {"object": live}}).encode()

    def recover():
        with Session(owner_engine) as session:
            return service.reconcile_checkout_session(session, tenant_id=tenant_id,
                user_id=user_id, session_id="cs_concurrent")["subscription"].status

    def webhook():
        with Session(owner_engine) as session:
            return service.process_stripe_webhook(session, payload=payload, signature_header="synthetic")

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            recovery_future = executor.submit(recover)
            assert lookup_started.wait(10)
            webhook_future = executor.submit(webhook)
            release_lookup.set()
            # A response may already see the concurrent cancellation. The
            # authoritative final state below must remain canceled.
            assert recovery_future.result(timeout=15) in {"active", "canceled"}
            assert webhook_future.result(timeout=15) == {"status": "processed"}
        with Session(owner_engine) as check:
            assert check.query(Subscription).filter_by(tenant_id=tenant_id).one().status == "canceled"
            assert len(lookups) == 2
    finally:
        release_lookup.set()
        with Session(owner_engine) as cleanup:
            cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(WebhookEvent).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Subscription).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Tenant).filter_by(id=tenant_id).delete()
            cleanup.query(User).filter_by(id=user_id).delete()
            cleanup.commit()

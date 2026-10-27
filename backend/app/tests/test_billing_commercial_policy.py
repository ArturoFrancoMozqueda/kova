"""An authenticated session is not permission to operate an unpaid business."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.auth.models import Membership
from app.billing import service
from app.billing.access import get_billing_access_status
from app.billing.models import Subscription
from app.billing.stripe_client import StripeSubscriptionError
from app.config import settings
from app.tenants.models import Tenant
from app.tests.test_billing_api import _signup_verify_login, _stripe_signature

pytestmark = pytest.mark.usefixtures("fast_business_auth")

COMMERCIAL_READS = (
    "/api/v1/branches", "/api/v1/settings/business-profile", "/api/v1/settings/receipt",
    "/api/v1/employees", "/api/v1/assistant/capabilities", "/api/v1/assistant/conversations",
    "/api/v1/onboarding/state", "/api/v1/catalog/products", "/api/v1/inventory/stock",
    "/api/v1/reports/dashboard", "/api/v1/orders", "/api/v1/customer-orders",
    "/api/v1/customers", "/api/v1/appointments", "/api/v1/service-cases",
    "/api/v1/quotes", "/api/v1/loyalty", "/api/v1/crm", "/api/v1/operations/queue",
    "/api/v1/purchasing/orders", "/api/v1/replenishment", "/api/v1/reconciliation/entries",
    "/api/v1/messaging/connection", "/api/v1/automations", "/api/v1/fiscal/global-drafts/settings",
    "/api/v1/integrations/readiness", "/api/v1/integrations/cfdi/status",
    "/api/v1/hardware/drawer", "/api/v1/catalog/modifier-groups", "/api/v1/expenses",
)


@pytest.fixture
def owner(client, db):
    signup = _signup_verify_login(client, f"commercial-{uuid4().hex}@example.com", "Commercial gate")
    return UUID(signup["tenant_id"])


def _block(db, tenant_id, status):
    now = datetime.now(UTC)
    if status == "signup_trial_expired":
        db.get(Tenant, tenant_id).created_at = now - timedelta(days=8)
    else:
        row = Subscription(tenant_id=tenant_id, status=status,
            stripe_subscription_id=f"sub_{uuid4().hex}", stripe_customer_id=f"cus_{uuid4().hex}")
        if status == "past_due":
            row.past_due_at = now - timedelta(hours=49)
            # Previously configured seven-day grace must also be capped to 48h.
            row.grace_period_ends_at = now + timedelta(days=5)
        if status == "trialing":
            row.stripe_subscription_id = None
            row.trial_ends_at = now - timedelta(seconds=1)
        db.add(row)
    db.commit()


@pytest.mark.parametrize("status", ["canceled", "unpaid", "incomplete", "incomplete_expired", "past_due", "trialing", "signup_trial_expired"])
def test_live_session_cannot_read_any_commercial_module(client, db, owner, status):
    _block(db, owner, status)
    for path in COMMERCIAL_READS:
        response = client.get(path)
        assert response.status_code == 402, (status, path, response.text)
        assert response.json()["detail"]["recovery_path"] == "/settings/billing"
    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200, session.text
    assert session.json()["authenticated"] is True
    assert session.json()["commercial_access"]["allowed"] is False


@pytest.mark.parametrize("status", ["canceled", "unpaid", "incomplete", "past_due", "signup_trial_expired"])
def test_blocked_session_cannot_use_write_or_offline_ingress(client, db, owner, status):
    _block(db, owner, status)
    for path, body in (
        ("/api/v1/assistant/conversations", {"title": "Cannot create"}),
        ("/api/v1/assistant/memory", {"content": "Cannot create"}),
        ("/api/v1/catalog/products", {"name": "Blocked", "price_amount": "10.00"}),
        ("/api/v1/orders", {}),
        ("/api/v1/sync/offline-sales", {"sales": []}),
        ("/api/v1/automations/process", None),
    ):
        response = client.post(path, json=body, headers={"Idempotency-Key": str(uuid4())})
        assert response.status_code == 402, (path, response.text)


def test_blocked_owner_keeps_data_rights_and_billing_recovery(client, db, owner):
    _block(db, owner, "canceled")
    for path in ("/api/v1/billing/subscription", "/api/v1/account/deletion",
                 "/api/v1/export/account", "/api/v1/assistant/export",
                 "/api/v1/assistant/preferences"):
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
    assert client.post("/api/v1/auth/logout").status_code == 204


def test_rbac_still_precedes_commercial_block_and_employee_has_session_status(client, db, owner):
    member = db.query(Membership).filter_by(tenant_id=owner).one()
    member.role = "cashier"
    db.commit()
    _block(db, owner, "unpaid")
    assert client.get("/api/v1/employees").status_code == 403
    assert client.get("/api/v1/assistant/conversations").status_code == 403
    assert client.get("/api/v1/billing/subscription").status_code == 403
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    assert response.json()["commercial_access"]["allowed"] is False


def _active(db, tenant_id, *, age=timedelta(), period=timedelta(days=30)):
    now = datetime.now(UTC)
    row = Subscription(tenant_id=tenant_id, stripe_subscription_id="sub_snapshot",
        stripe_customer_id="cus_snapshot", status="active",
        current_period_end=now + period, stripe_period_synced_at=now - age,
        updated_at=now - age)
    db.add(row)
    db.commit()
    return row


def _source(status="active", *, period=timedelta(days=30)):
    now = datetime.now(UTC)
    return {"id": "sub_snapshot", "object": "subscription", "customer": "cus_snapshot",
        "livemode": False, "status": status,
        "current_period_start": int((now - timedelta(days=1)).timestamp()),
        "current_period_end": int((now + period).timestamp())}


@pytest.mark.parametrize("age,period", [(timedelta(hours=25), timedelta(days=30)), (timedelta(), timedelta(days=-30))])
def test_stale_paid_state_rechecks_current_stripe_instead_of_allowing_forever(client, db, owner, monkeypatch, age, period):
    row = _active(db, owner, age=age, period=period)
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic")  # gitleaks:allow
    calls = []
    def retrieve(**kwargs):
        calls.append(kwargs)
        return _source("canceled")
    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    response = client.get("/api/v1/branches")
    assert response.status_code == 402
    db.refresh(row)
    assert row.status == "canceled"
    assert len(calls) == 1


def test_fresh_paid_snapshot_is_bounded_by_period_and_24_hours(client, db, owner):
    row = _active(db, owner, period=timedelta(hours=4))
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    access = response.json()["commercial_access"]
    assert access["allowed"] is True
    assert datetime.fromisoformat(access["valid_until"].replace("Z", "+00:00")) == row.current_period_end


@pytest.mark.parametrize("problem", ["outage", "missing_period", "expired_period", "foreign_customer", "test_mode"])
def test_unverifiable_paid_state_fails_closed_without_inventing_cancellation(client, db, owner, monkeypatch, problem):
    row = _active(db, owner, age=timedelta(hours=25))
    old_updated = row.updated_at
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic")  # gitleaks:allow
    source = _source()
    if problem == "missing_period":
        source.pop("current_period_end")
    elif problem == "expired_period":
        source = _source(period=timedelta(days=-1))
    elif problem == "foreign_customer":
        source["customer"] = "cus_foreign"
    elif problem == "test_mode":
        monkeypatch.setattr(settings, "app_env", "production")
        source["livemode"] = False
    def retrieve(**kwargs):
        if problem == "outage":
            raise StripeSubscriptionError("synthetic outage")
        return source
    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    assert response.json()["commercial_access"]["allowed"] is False
    assert response.json()["commercial_access"]["reason"] == "verification_required"
    assert client.get("/api/v1/branches").status_code == 402
    db.refresh(row)
    assert row.status == "active"
    if problem != "expired_period":
        assert row.updated_at == old_updated


def test_grace_stops_at_exactly_48_hours_and_repeated_failures_cannot_extend_it(db, owner):
    first = datetime.now(UTC) - timedelta(hours=48)
    row = Subscription(tenant_id=owner, stripe_subscription_id="sub_due", status="past_due",
        past_due_at=first, grace_period_ends_at=first + timedelta(days=7))
    db.add(row)
    db.commit()
    assert get_billing_access_status(db, tenant_id=owner).allowed is False
    service._mark_subscription_past_due(row)
    db.commit()
    assert row.past_due_at == first
    assert row.grace_period_ends_at == first + timedelta(hours=48)
    assert get_billing_access_status(db, tenant_id=owner).allowed is False


@pytest.mark.parametrize("entrypoint", ["session_probe", "checkout_reconcile"])
def test_unknown_grace_provenance_cannot_start_at_the_time_of_an_authoritative_lookup(
    client, db, owner, monkeypatch, entrypoint,
):
    row = _active(db, owner, age=timedelta(hours=25))
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic")  # gitleaks:allow
    current = _source("past_due")
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **kwargs: current)
    if entrypoint == "session_probe":
        response = client.get("/api/v1/auth/session")
        assert response.status_code == 200, response.text
        access = response.json()["commercial_access"]
    else:
        monkeypatch.setattr(service.checkout_client, "retrieve_session", lambda **kwargs: {
            "id": "cs_old_paid", "object": "checkout.session", "mode": "subscription",
            "livemode": False, "status": "complete", "payment_status": "paid",
            "customer": "cus_snapshot", "subscription": "sub_snapshot",
            "metadata": {"tenant_id": str(owner)},
        })
        response = client.post("/api/v1/billing/checkout/reconcile",
                               json={"checkout_session_id": "cs_old_paid"})
        assert response.status_code == 200, response.text
        access = response.json()["access"]
    assert access["allowed"] is False
    db.refresh(row)
    assert row.status == "past_due"
    assert row.past_due_at is None
    assert row.grace_period_ends_at is None


def test_legacy_grace_without_a_first_failure_timestamp_does_not_use_last_update_as_proof(
    client, db, owner,
):
    row = _active(db, owner)
    row.status = "past_due"
    row.grace_period_ends_at = datetime.now(UTC) + timedelta(hours=48)
    db.commit()
    deadline = row.grace_period_ends_at
    assert client.get("/api/v1/branches").status_code == 402
    db.refresh(row)
    assert row.past_due_at is None
    assert row.grace_period_ends_at == deadline


@pytest.mark.parametrize("attempt_count", [1, 2, None, True])
def test_only_a_verified_first_invoice_attempt_can_start_grace(
    client, db, owner, monkeypatch, attempt_count,
):
    row = _active(db, owner)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow
    stamp = int(datetime.now(UTC).timestamp())
    payload = json.dumps({"id": f"evt_{uuid4().hex}", "type": "invoice.payment_failed", "created": stamp,
        "data": {"object": {"id": "in_first", "object": "invoice", "subscription": "sub_snapshot",
                            "attempt_count": attempt_count}}}).encode()
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload)})
    assert response.status_code == 200, response.text
    db.refresh(row)
    status = get_billing_access_status(db, tenant_id=owner)
    first_attempt = type(attempt_count) is int and attempt_count == 1
    assert status.allowed is first_attempt
    if first_attempt:
        assert row.past_due_at == datetime.fromtimestamp(stamp, UTC)
        assert row.grace_period_ends_at == row.past_due_at + timedelta(hours=48)
    else:
        assert row.past_due_at is None and row.grace_period_ends_at is None


def test_verified_old_failure_and_retries_never_restart_grace_on_delivery(
    client, db, owner, monkeypatch,
):
    row = _active(db, owner)
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow
    first_stamp = int((datetime.now(UTC) - timedelta(hours=49)).timestamp())
    for attempt, stamp in ((1, first_stamp), (2, int(datetime.now(UTC).timestamp()))):
        payload = json.dumps({"id": f"evt_{uuid4().hex}", "type": "invoice.payment_failed", "created": stamp,
            "data": {"object": {"id": "in_old_failed", "object": "invoice", "subscription": "sub_snapshot",
                                "attempt_count": attempt}}}).encode()
        response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                               headers={"Stripe-Signature": _stripe_signature(payload)})
        assert response.status_code == 200, response.text
        db.refresh(row)
        assert row.past_due_at == datetime.fromtimestamp(first_stamp, UTC)
        assert row.grace_period_ends_at == row.past_due_at + timedelta(hours=48)
        assert get_billing_access_status(db, tenant_id=owner).allowed is False


def test_verified_first_invoice_still_establishes_grace_after_a_poll_observed_unknown_debt(
    client, db, owner, monkeypatch,
):
    row = _active(db, owner, age=timedelta(hours=25))
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic")  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")  # gitleaks:allow
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **kwargs: _source("past_due"))
    assert client.get("/api/v1/auth/session").json()["commercial_access"]["allowed"] is False
    stamp = int(datetime.now(UTC).timestamp())
    payload = json.dumps({"id": f"evt_{uuid4().hex}", "type": "invoice.payment_failed", "created": stamp,
        "data": {"object": {"id": "in_proved_first", "object": "invoice", "subscription": "sub_snapshot",
                            "attempt_count": 1}}}).encode()
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload)})
    assert response.status_code == 200, response.text
    db.refresh(row)
    assert row.past_due_at == datetime.fromtimestamp(stamp, UTC)
    assert row.grace_period_ends_at == row.past_due_at + timedelta(hours=48)
    assert get_billing_access_status(db, tenant_id=owner).allowed is True

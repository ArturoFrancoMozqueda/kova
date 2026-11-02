"""A browser key or an ambiguous HTTP result must never create a second payable session."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.account_lifecycle.models import AccountDeletionRequest
from app.account_lifecycle.service import AccountPurgeBatchError, purge_due_accounts
from app.auth.models import UserSession
from app.billing import service
from app.billing.models import CheckoutAttempt, Subscription
from app.billing.stripe_client import StripeCheckoutError
from app.config import settings
from app.tenants.models import Tenant
from app.tests.test_billing_api import (
    FakeStripePriceClient,
    _configure_stripe,
    _signup_verify_login,
)
from app.tests.test_billing_tiered_plans import _price, _source
from app.tests.test_billing_tiered_plans import new_owner as new_owner
from app.tests.test_billing_tiered_plans import tiered_settings as tiered_settings

pytestmark = pytest.mark.usefixtures("fast_business_auth")


class DurableStripe:
    def __init__(self, failure=None):
        self.calls = []
        self.sessions = {}
        self.failure = failure
        self.after_create = None

    def create_checkout_session(self, **kwargs):
        self.calls.append(deepcopy(kwargs))
        session = self.sessions.setdefault(kwargs["idempotency_key"], {
            "id": "cs_test_" + uuid4().hex, "url": "https://checkout.stripe.test/synthetic",
            "mode": "subscription", "status": "open", "livemode": False,
            "metadata": {"tenant_id": kwargs["tenant_id"]}, "customer": kwargs["customer"],
        })
        failure, self.failure = self.failure, None
        if self.after_create:
            self.after_create()
        if failure == "timeout":
            raise TimeoutError("Synthetic timeout after provider side effect")
        if failure == "provider":
            raise StripeCheckoutError("Synthetic uncertain provider result")
        if failure == "missing_id":
            return {"status": "open", "url": session["url"]}
        if failure == "missing_url":
            return {"status": "open", "id": session["id"]}
        return deepcopy(session)

    def retrieve_session(self, *, secret_key, session_id):
        return deepcopy(next(s for s in self.sessions.values() if s["id"] == session_id))

    @property
    def session(self):
        return next(iter(self.sessions.values()))


@pytest.fixture
def owner(client, monkeypatch):
    _configure_stripe(monkeypatch)
    return _signup_verify_login(client, f"durable-{uuid4().hex}@example.com", "Durable checkout")


def _post(client, key, plan=None):
    return client.post("/api/v1/billing/checkout", headers={"Idempotency-Key": key},
                       json={"plan_code": plan} if plan else None)


@pytest.mark.parametrize("failure", ["timeout", "provider", "missing_id", "missing_url"])
def test_uncertain_outcome_reuses_durable_key_and_frozen_payload_across_browser_keys(
    client, db, monkeypatch, owner, failure,
):
    fake = DurableStripe(failure)
    monkeypatch.setattr(service, "checkout_client", fake)
    failed = _post(client, "first-tab")
    assert failed.status_code == 502, failed.text
    attempt = db.query(CheckoutAttempt).filter_by(tenant_id=UUID(owner["tenant_id"])).one()
    reserved_id = attempt.id
    assert attempt.status in {"uncertain", "open"}
    assert len(fake.sessions) == 1
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://changed.test/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://changed.test/cancel")
    recovered = _post(client, "second-tab")
    assert recovered.status_code == 201, recovered.text
    assert recovered.json()["checkout_session_id"] == fake.session["id"]
    db.refresh(attempt)
    assert attempt.id == reserved_id
    assert len(fake.sessions) == 1
    assert len({call["idempotency_key"] for call in fake.calls}) == 1
    assert all(call == fake.calls[0] for call in fake.calls)


def test_open_attempt_reuses_one_session_with_distinct_keys(client, monkeypatch, owner):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    first = _post(client, "a")
    second = _post(client, "b")
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert len(fake.calls) == len(fake.sessions) == 1


def test_open_attempt_for_another_plan_blocks_without_another_charge(
    client, monkeypatch, new_owner,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=_price("esencial")))
    assert _post(client, "a", "esencial").status_code == 201
    blocked = _post(client, "b", "gestion")
    assert blocked.status_code == 409, blocked.text
    assert len(fake.calls) == len(fake.sessions) == 1


def test_unknown_result_after_23_hours_never_recreates_a_stripe_object(
    client, db, monkeypatch, owner,
):
    fake = DurableStripe("timeout")
    monkeypatch.setattr(service, "checkout_client", fake)
    assert _post(client, "a").status_code == 502
    attempt = db.query(CheckoutAttempt).filter_by(tenant_id=UUID(owner["tenant_id"])).one()
    attempt.created_at = datetime.now(UTC) - timedelta(hours=23, seconds=1)
    db.commit()
    assert _post(client, "b").status_code == 503
    assert len(fake.calls) == len(fake.sessions) == 1


def test_verified_expired_session_allows_another_plan_with_a_new_attempt(
    client, db, monkeypatch, new_owner,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=_price("esencial")))
    assert _post(client, "a", "esencial").status_code == 201
    old_key = fake.calls[0]["idempotency_key"]
    fake.session["status"] = "expired"
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=_price("gestion")))
    second = _post(client, "b", "gestion")
    assert second.status_code == 201, second.text
    assert fake.calls[1]["idempotency_key"] != old_key
    assert len(fake.sessions) == 2
    assert sum(s["status"] == "open" for s in fake.sessions.values()) == 1


@pytest.mark.parametrize("status", ["active", "incomplete"])
def test_complete_session_is_reconciled_before_any_new_session_even_if_unpaid(
    client, db, monkeypatch, new_owner, status,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=_price("esencial")))
    assert _post(client, "a", "esencial").status_code == 201
    fake.session.update(status="complete", subscription="sub_plan", customer="cus_plan")
    live = _source(new_owner["tenant_id"], paid=status == "active", status=status)
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(live))
    response = _post(client, "b", "gestion")
    assert response.status_code == 409, response.text
    row = db.query(Subscription).filter_by(tenant_id=UUID(new_owner["tenant_id"])).one()
    assert row.stripe_subscription_id == "sub_plan" and row.status == status
    assert len(fake.calls) == 1


def test_incomplete_historical_subscription_is_not_evidence_that_it_cannot_bill(
    client, db, monkeypatch, owner,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    db.add(Subscription(tenant_id=UUID(owner["tenant_id"]), status="incomplete",
                        stripe_subscription_id="sub_historical", stripe_customer_id="cus_history"))
    db.commit()
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: {
        "id": "sub_historical", "object": "subscription", "status": "incomplete",
        "customer": "cus_history", "livemode": False,
    })
    response = _post(client, "a")
    assert response.status_code == 409, response.text
    assert not fake.calls


def test_revoked_session_after_provider_response_preserves_attempt_and_withholds_url(
    client, db, monkeypatch, owner,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    def revoke():
        db.query(UserSession).filter_by(tenant_id=UUID(owner["tenant_id"])).update(
            {"revoked_at": datetime.now(UTC)}, synchronize_session=False,
        )
        db.commit()
    fake.after_create = revoke
    response = _post(client, "a")
    assert response.status_code == 403, response.text
    assert "checkout_url" not in response.json()
    attempt = db.query(CheckoutAttempt).filter_by(tenant_id=UUID(owner["tenant_id"])).one()
    assert attempt.stripe_session_id == fake.session["id"]


def test_account_purge_cannot_erase_unknown_or_open_checkout(client, db, monkeypatch, owner):
    fake = DurableStripe("timeout")
    monkeypatch.setattr(service, "checkout_client", fake)
    assert _post(client, "a").status_code == 502
    with pytest.raises(StripeCheckoutError, match="purge"):
        service.assert_checkout_resolved_for_account_purge(db, tenant_id=UUID(owner["tenant_id"]))
    assert _post(client, "b").status_code == 201
    with pytest.raises(StripeCheckoutError, match="purge"):
        service.assert_checkout_resolved_for_account_purge(db, tenant_id=UUID(owner["tenant_id"]))
    fake.session["status"] = "expired"
    service.assert_checkout_resolved_for_account_purge(db, tenant_id=UUID(owner["tenant_id"]))


def test_pending_account_deletion_prevents_checkout_without_calling_stripe(
    client, db, monkeypatch, owner,
):
    fake = DurableStripe()
    monkeypatch.setattr(service, "checkout_client", fake)
    db.add(AccountDeletionRequest(tenant_id=UUID(owner["tenant_id"]),
                                 purge_after=datetime.now(UTC) + timedelta(days=30)))
    db.commit()
    response = _post(client, "deleting")
    assert response.status_code == 409, response.text
    assert not fake.calls
    assert db.query(CheckoutAttempt).filter_by(tenant_id=UUID(owner["tenant_id"])).count() == 0


def test_due_account_purge_keeps_uncertain_attempt_and_pending_request(
    client, db, monkeypatch, owner,
):
    fake = DurableStripe("timeout")
    monkeypatch.setattr(service, "checkout_client", fake)
    assert _post(client, "a").status_code == 502
    tenant_id = UUID(owner["tenant_id"])
    request = AccountDeletionRequest(tenant_id=tenant_id,
                                     purge_after=datetime.now(UTC) - timedelta(minutes=1))
    db.add(request)
    db.commit()
    with pytest.raises(AccountPurgeBatchError):
        purge_due_accounts(db)
    assert db.get(Tenant, tenant_id) is not None
    assert db.query(CheckoutAttempt).filter_by(tenant_id=tenant_id).one().status == "uncertain"
    db.refresh(request)
    assert request.status == "pending"
    assert len(fake.calls) == 1


def test_internal_cancellation_does_not_commit_or_evaluate_access_during_account_deletion(
    client, db, monkeypatch, owner,
):
    tenant_id = UUID(owner["tenant_id"])
    db.add(Subscription(tenant_id=tenant_id, status="active", stripe_subscription_id="sub_cancel",
                        stripe_customer_id="cus_cancel"))
    db.commit()
    monkeypatch.setattr(service.subscription_client, "update_cancel_at_period_end", lambda **_: {
        "id": "sub_cancel", "status": "active", "cancel_at_period_end": True,
    })
    def unexpected_status(*args, **kwargs):
        raise AssertionError("Internal cancellation must not evaluate access or commit")
    monkeypatch.setattr(service, "get_subscription_status", unexpected_status)
    commits = []
    original_commit = db.commit
    def tracked_commit():
        commits.append(True)
        original_commit()
    monkeypatch.setattr(db, "commit", tracked_commit)
    response = client.post("/api/v1/account/deletion", json={
        "password": "S3cur3pass!", "tenant_name": "Durable checkout",
    })
    assert response.status_code == 200, response.text
    assert len(commits) == 1
    assert db.query(AccountDeletionRequest).filter_by(tenant_id=tenant_id).one().status == "pending"
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).one().cancel_at_period_end is True

"""Commercial agreements are server-owned and follow paid Stripe state, not UI selection."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.billing import service
from app.billing.access import get_billing_access_status
from app.billing.models import Subscription
from app.billing.plans import PLANS, build_plan_snapshot, plan_has_feature, tiered_pricing_enabled
from app.config import settings
from app.tenants.models import Tenant
from app.tests.test_billing_api import (
    FakeStripeCheckoutClient,
    FakeStripePriceClient,
    _set_role,
    _signup_verify_login,
    _stripe_signature,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.fixture
def tiered_settings(monkeypatch):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "rk_test_synthetic_plans")  # gitleaks:allow
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_standard")
    monkeypatch.setattr(settings, "stripe_esencial_price_id", "price_esencial")
    monkeypatch.setattr(settings, "stripe_gestion_price_id", "price_gestion")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/billing/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/billing/cancel")


@pytest.fixture
def new_owner(client, db, tiered_settings):
    signup = _signup_verify_login(client, f"plans-{uuid4().hex}@example.com", "Plan agreement")
    # Cohort assignment is checked separately through auth; these billing scenarios
    # focus on a persisted server-side cohort, independent of the rollout switch.
    tenant = db.get(Tenant, UUID(signup["tenant_id"]))
    tenant.billing_cohort = "tiered"
    db.commit()
    return signup


def _price(code):
    return {"id": f"price_{code}", "unit_amount": PLANS[code].amount_minor_units,
            "currency": "mxn", "tax_behavior": "inclusive", "active": True,
            "recurring": {"interval": "month", "interval_count": 1}}


def _source(tenant_id, code="esencial", *, paid=True, status="active", period_start=None):
    now = datetime.now(UTC)
    start = int((period_start or now - timedelta(days=1)).timestamp())
    end = int((now + timedelta(days=29)).timestamp())
    return {
        "id": "sub_plan", "object": "subscription", "customer": "cus_plan",
        "livemode": False, "status": status, "metadata": {"tenant_id": str(tenant_id)},
        "current_period_start": start, "current_period_end": end,
        "trial_end": end if status == "trialing" else None,
        "items": {"data": [{"price": _price(code), "quantity": 1}]},
        "latest_invoice": {
            "id": "in_plan", "status": "paid" if paid else "open", "customer": "cus_plan",
            "amount_remaining": 0 if paid else PLANS[code].amount_minor_units,
            "parent": {"subscription_details": {"subscription": "sub_plan"}},
            "lines": {"data": [{"amount": PLANS[code].amount_minor_units,
                                "pricing": {"price_details": {"price": f"price_{code}"}},
                                "period": {"start": start, "end": end}}]},
        },
    }


def _apply(db, monkeypatch, signup, source):
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    row = service._upsert_subscription_from_stripe_object(
        db, tenant_id=UUID(signup["tenant_id"]), stripe_object=source,
    )
    db.commit()
    return row


def test_default_off_preserves_standard_and_does_not_advertise_new_prices(client, db, monkeypatch):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    signup = _signup_verify_login(client, f"legacy-{uuid4().hex}@example.com", "Legacy agreement")
    assert db.get(Tenant, UUID(signup["tenant_id"])).billing_cohort == "standard"
    response = client.get("/api/v1/billing/subscription")
    assert response.status_code == 200
    body = response.json()
    assert body["tiered_pricing_enabled"] is False
    assert body["plan"]["amount_minor_units"] == 29900
    assert [p["code"] for p in body["available_plans"]] == ["standard"]
    assert body["access"]["plan_code"] == "standard"
    assert body["access"]["limits"]["branches"] is None
    assert "advanced_reports" in body["access"]["features"]


def test_enabling_catalog_does_not_migrate_existing_standard(client, db, monkeypatch, tiered_settings):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    signup = _signup_verify_login(client, f"existing-{uuid4().hex}@example.com", "Existing")
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    response = client.get("/api/v1/billing/subscription")
    assert response.json()["access"]["plan_code"] == "standard"
    assert db.get(Tenant, UUID(signup["tenant_id"])).billing_cohort == "standard"
    blocked = client.post("/api/v1/billing/checkout", json={"plan_code": "gestion"},
                          headers={"Idempotency-Key": "no-migrate"})
    assert blocked.status_code == 400


def test_trial_catalog_is_cohort_scoped_and_contains_no_stripe_ids(client, new_owner):
    body = client.get("/api/v1/billing/subscription").json()
    assert body["tiered_pricing_enabled"] is True
    assert [(p["code"], p["amount_minor_units"]) for p in body["available_plans"]] == [
        ("esencial", 39900), ("gestion", 69900),
    ]
    assert body["access"]["plan_code"] == "gestion"
    assert all(p["tax_inclusive"] is True for p in body["available_plans"])
    assert all(p["limits"]["branches"] == 1 for p in body["available_plans"])
    assert body["access"]["limits"]["branches"] == 1
    assert "price_esencial" not in str(body) and "price_gestion" not in str(body)


def test_paid_entitlements_survive_enrollment_switch_off(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"], "gestion"))
    assert row.plan_code == "gestion"
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    snapshot = build_plan_snapshot(db, tenant_id=row.tenant_id)
    assert snapshot["plan_code"] == "gestion" and "purchasing" in snapshot["features"]
    assert tiered_pricing_enabled() is False


def test_tiered_checkout_requires_explicit_selection_and_rejects_client_price(client, new_owner):
    missing = client.post("/api/v1/billing/checkout", headers={"Idempotency-Key": "missing"})
    assert missing.status_code == 400
    injected = client.post("/api/v1/billing/checkout",
                           json={"plan_code": "esencial", "price_id": "price_other"},
                           headers={"Idempotency-Key": "injected"})
    assert injected.status_code == 422


@pytest.mark.parametrize("code", ["esencial", "gestion"])
def test_checkout_uses_server_catalog_and_existing_idempotency(
    client, new_owner, monkeypatch, code,
):
    checkout = FakeStripeCheckoutClient()
    monkeypatch.setattr(service, "checkout_client", checkout)
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=_price(code)))
    key = {"Idempotency-Key": "selected-plan"}
    first = client.post("/api/v1/billing/checkout", json={"plan_code": code}, headers=key)
    assert first.status_code == 201, first.text
    assert checkout.calls[0]["price_id"] == f"price_{code}"
    second = client.post("/api/v1/billing/checkout", json={"plan_code": code}, headers=key)
    assert second.status_code == 201 and len(checkout.calls) == 1
    conflict = client.post("/api/v1/billing/checkout",
                           json={"plan_code": "gestion" if code == "esencial" else "esencial"},
                           headers=key)
    assert conflict.status_code == 400
    assert "Idempotency key reused" in conflict.json()["detail"]


def test_exclusive_tax_price_cannot_charge_a_promised_final_price(client, new_owner, monkeypatch):
    price = _price("esencial")
    price["tax_behavior"] = "exclusive"
    checkout = FakeStripeCheckoutClient()
    monkeypatch.setattr(service, "checkout_client", checkout)
    monkeypatch.setattr(service, "price_client", FakeStripePriceClient(price=price))
    result = client.post("/api/v1/billing/checkout", json={"plan_code": "esencial"},
                         headers={"Idempotency-Key": "exclusive"})
    assert result.status_code == 503 and checkout.calls == []


def test_pending_or_unpaid_upgrade_preserves_previous_plan(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    next_source = _source(new_owner["tenant_id"], "gestion", paid=False)
    _apply(db, monkeypatch, new_owner, next_source)
    db.refresh(row)
    assert row.plan_code == "esencial" and row.amount_minor_units == 39900
    next_source["latest_invoice"]["status"] = "paid"
    next_source["latest_invoice"]["amount_remaining"] = 0
    next_source["pending_update"] = {"expires_at": int(datetime.now(UTC).timestamp()) + 300}
    _apply(db, monkeypatch, new_owner, next_source)
    assert row.plan_code == "esencial"


def test_a_paid_invoice_for_old_price_does_not_unlock_upgrade(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    source = _source(new_owner["tenant_id"], "gestion")
    source["latest_invoice"]["lines"]["data"][0]["pricing"]["price_details"]["price"] = "price_esencial"
    _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "esencial"


def test_paid_current_invoice_unlocks_upgrade(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"], "gestion"))
    assert row.plan_code == "gestion" and row.amount_minor_units == 69900
    assert plan_has_feature(db, tenant_id=row.tenant_id, feature="purchasing")


@pytest.mark.parametrize("invalid_proof", ["remaining", "credit", "empty_page"])
def test_upgrade_requires_settled_invoice_with_positive_current_price_line(
    db, monkeypatch, new_owner, invalid_proof,
):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    source = _source(row.tenant_id, "gestion")
    invoice = source["latest_invoice"]
    if invalid_proof == "remaining":
        invoice["amount_remaining"] = 100
    elif invalid_proof == "credit":
        invoice["lines"]["data"][0]["amount"] = -69900
    else:
        invoice["lines"] = {"data": [], "has_more": True}
    _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "esencial"


def test_downgrade_waits_for_entitled_period_end(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"], "gestion"))
    _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"], "esencial"))
    assert row.plan_code == "gestion"
    row.plan_effective_until = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"], "esencial"))
    assert row.plan_code == "esencial"


def test_unknown_price_fails_closed_instead_of_matching_by_amount(db, monkeypatch, new_owner):
    source = _source(new_owner["tenant_id"], "gestion")
    source["items"]["data"][0]["price"]["id"] = "price_unrecognized"
    row = _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "unknown"
    assert build_plan_snapshot(db, tenant_id=row.tenant_id)["features"] == []
    assert build_plan_snapshot(db, tenant_id=row.tenant_id)["limits"]["branches"] is None
    status = get_billing_access_status(db, tenant_id=row.tenant_id)
    assert not status.allowed and status.reason == "verification_required"


def test_unknown_quantity_cannot_unlock_premium(db, monkeypatch, new_owner):
    source = _source(new_owner["tenant_id"], "gestion")
    source["items"]["data"][0]["quantity"] = 2
    row = _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "unknown"


def test_unknown_plan_does_not_receive_an_activation_welcome(db, monkeypatch, new_owner):
    from unittest.mock import Mock

    source = _source(new_owner["tenant_id"], "gestion")
    source["items"]["data"][0]["price"]["id"] = "price_unrecognized"
    row = _apply(db, monkeypatch, new_owner, source)
    assert row.status == "active" and row.plan_code == "unknown"
    send = Mock()
    monkeypatch.setattr(service.email_service, "send_welcome_email", send)
    service._send_welcome_email_for_tenant(db, tenant_id=row.tenant_id)
    send.assert_not_called()


def test_access_refresh_to_unknown_price_also_fails_closed(db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    row.plan_effective_until = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    source = _source(row.tenant_id)
    source["items"]["data"][0]["price"]["id"] = "price_unrecognized"
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    access = get_billing_access_status(db, tenant_id=row.tenant_id)
    assert not access.allowed and access.reason == "verification_required"
    assert row.plan_code == "unknown"


def test_billing_page_can_recover_unknown_plan_after_payment(client, db, monkeypatch, new_owner):
    source = _source(new_owner["tenant_id"], paid=False)
    row = _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "unknown"
    source["latest_invoice"]["status"] = "paid"
    source["latest_invoice"]["amount_remaining"] = 0
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    body = client.get("/api/v1/billing/subscription").json()
    assert body["access"]["allowed"] is True
    assert body["access"]["plan_code"] == "esencial"


def test_public_catalog_uses_server_rollout_without_tenant_or_stripe_ids(
    client, monkeypatch, tiered_settings,
):
    response = client.get("/api/v1/billing/plans")
    assert response.status_code == 200
    assert [p["code"] for p in response.json()["available_plans"]] == ["esencial", "gestion"]
    assert "price_esencial" not in response.text
    monkeypatch.setattr(settings, "stripe_gestion_price_id", None)
    disabled = client.get("/api/v1/billing/plans").json()
    assert not disabled["tiered_pricing_enabled"]
    assert [p["code"] for p in disabled["available_plans"]] == ["standard"]


def test_complimentary_access_keeps_all_features_without_checkout(client, db, new_owner):
    tenant_id = UUID(new_owner["tenant_id"])
    db.add(Subscription(tenant_id=tenant_id, complimentary_access=True, status="incomplete"))
    db.commit()
    snapshot = client.get("/api/v1/billing/subscription").json()
    assert snapshot["access"]["reason"] == "complimentary"
    assert snapshot["access"]["plan_code"] == "standard"
    assert "purchasing" in snapshot["access"]["features"]
    assert snapshot["access"]["limits"]["product_image_bytes"] is None
    assert snapshot["access"]["limits"]["branches"] is None
    assert client.post("/api/v1/billing/checkout", json={"plan_code": "esencial"},
                       headers={"Idempotency-Key": "no-courtesy-charge"}).status_code == 400


def test_invoice_paid_converges_a_previously_pending_plan(client, db, monkeypatch, new_owner):
    tenant_id = UUID(new_owner["tenant_id"])
    row = _apply(db, monkeypatch, new_owner, _source(tenant_id))
    source = _source(tenant_id, "gestion", paid=False)
    _apply(db, monkeypatch, new_owner, source)
    assert row.plan_code == "esencial"
    source["latest_invoice"]["status"] = "paid"
    source["latest_invoice"]["amount_remaining"] = 0
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    monkeypatch.setattr(settings, "stripe_webhook_secret", "synthetic-webhook")
    event = {"id": "evt_paid_tier", "type": "invoice.paid", "created": int(datetime.now(UTC).timestamp()),
             "data": {"object": {"id": "in_plan", "subscription": "sub_plan",
                                  "customer": "cus_plan", "amount_paid": 69900,
                                  "currency": "mxn", "metadata": {"tenant_id": str(tenant_id)}}}}
    import json
    payload = json.dumps(event).encode()
    signature = _stripe_signature(payload, "synthetic-webhook")
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": signature, "Content-Type": "application/json"})
    assert response.status_code == 200, response.text
    db.refresh(row)
    assert row.plan_code == "gestion"


@pytest.mark.parametrize("code", ["esencial", "gestion"])
@pytest.mark.parametrize("parent_reference", [False, True], ids=["legacy", "dahlia"])
def test_initial_paid_invoice_before_checkout_and_subscription_events_is_not_lost(
    client, db, monkeypatch, new_owner, code, parent_reference,
):
    import json

    from app.audit.models import AuditLog
    from app.billing.models import WebhookEvent

    tenant_id = UUID(new_owner["tenant_id"])
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).first() is None
    source = _source(tenant_id, code)
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    monkeypatch.setattr(settings, "stripe_webhook_secret", "synthetic-webhook")
    monkeypatch.setattr(service, "_send_payment_receipt_for_tenant", lambda *_a, **_k: None)
    invoice = {"id": "in_plan", "object": "invoice", "customer": "cus_plan", "livemode": False,
               "amount_paid": PLANS[code].amount_minor_units, "currency": "mxn", "metadata": {}}
    invoice.update({"parent": {"type": "subscription_details", "subscription_details": {
        "subscription": "sub_plan"}}} if parent_reference else {"subscription": "sub_plan"})
    created = int(datetime.now(UTC).timestamp())
    event = {"id": "evt_first_paid", "type": "invoice.paid", "created": created,
             "livemode": False, "data": {"object": invoice}}
    payload = json.dumps(event).encode()
    for _ in range(2):
        response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                               headers={"Stripe-Signature": _stripe_signature(payload, "synthetic-webhook")})
        assert response.status_code == 200, response.text
        assert response.json() == {"status": "processed"}
    row = db.query(Subscription).filter_by(tenant_id=tenant_id).one()
    assert row.stripe_subscription_id == "sub_plan"
    assert row.stripe_customer_id == "cus_plan"
    assert row.plan_code == code and row.status == "active"
    assert row.stripe_payment_watermark_at == datetime.fromtimestamp(created, UTC)
    stored = db.query(WebhookEvent).filter_by(stripe_event_id="evt_first_paid").one()
    assert stored.process_attempts == 1
    assert db.query(AuditLog).filter_by(tenant_id=tenant_id, action="billing.payment_succeeded").count() == 1


@pytest.mark.parametrize("mismatch", ["customer", "id", "object", "livemode", "tenant"])
def test_initial_invoice_mapping_checks_authoritative_identity_before_creating_a_subscription(
    db, monkeypatch, new_owner, mismatch,
):
    from fastapi import HTTPException

    tenant_id = UUID(new_owner["tenant_id"])
    source = _source(tenant_id)
    source[mismatch if mismatch != "tenant" else "metadata"] = (
        {"tenant_id": str(uuid4())} if mismatch == "tenant"
        else True if mismatch == "livemode" else "mismatched"
    )
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    kwargs = {"event_type": "invoice.paid", "event_payload": {"livemode": False},
              "stripe_object": {"subscription": "sub_plan", "customer": "cus_plan", "livemode": False},
              "tenant_id": tenant_id}
    with pytest.raises(HTTPException):
        service._initial_paid_invoice_subscription(db, **kwargs)
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).first() is None


@pytest.mark.parametrize("metadata", [{}, {"tenant_id": "not-a-tenant"}])
def test_first_invoice_cannot_use_an_unowned_provider_subscription(db, monkeypatch, new_owner, metadata):
    tenant_id = UUID(new_owner["tenant_id"])
    source = _source(tenant_id)
    source["metadata"] = metadata
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: deepcopy(source))
    owner, candidate = service._initial_paid_invoice_subscription(
        db, event_type="invoice.paid", event_payload={"livemode": False},
        stripe_object={"subscription": "sub_plan", "customer": "cus_plan", "livemode": False},
        tenant_id=tenant_id,
    )
    assert owner is None and candidate is None
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).first() is None


def test_initial_invoice_lookup_failure_remains_retryable_instead_of_permanently_ignored(
    client, db, monkeypatch, new_owner,
):
    import json

    from app.billing.models import WebhookEvent
    from app.billing.stripe_client import StripeSubscriptionError

    tenant_id = UUID(new_owner["tenant_id"])
    monkeypatch.setattr(settings, "stripe_webhook_secret", "synthetic-webhook")
    calls = []

    def retrieve(**_):
        calls.append(True)
        if len(calls) == 1:
            raise StripeSubscriptionError("Synthetic provider outage")
        return _source(tenant_id)

    monkeypatch.setattr(service.subscription_client, "retrieve", retrieve)
    monkeypatch.setattr(service, "_send_payment_receipt_for_tenant", lambda *_a, **_k: None)
    payload = json.dumps({"id": "evt_initial_retry", "type": "invoice.paid", "livemode": False,
                          "created": int(datetime.now(UTC).timestamp()), "data": {"object": {
                              "id": "in_plan", "subscription": "sub_plan", "customer": "cus_plan",
                              "livemode": False, "metadata": {}}}}).encode()
    headers = {"Stripe-Signature": _stripe_signature(payload, "synthetic-webhook")}
    with pytest.raises(StripeSubscriptionError):
        client.post("/api/v1/billing/webhooks/stripe", content=payload, headers=headers)
    assert db.query(WebhookEvent).filter_by(stripe_event_id="evt_initial_retry").one().processing_status == "failed"
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).first() is None
    assert client.post("/api/v1/billing/webhooks/stripe", content=payload,
                       headers=headers).json() == {"status": "processed"}
    assert db.query(Subscription).filter_by(tenant_id=tenant_id).one().stripe_payment_watermark_at is not None


def test_early_invoice_cannot_replace_a_previously_bound_customer(client, db, monkeypatch, new_owner):
    import json

    tenant_id = UUID(new_owner["tenant_id"])
    row = Subscription(tenant_id=tenant_id, stripe_customer_id="cus_existing", status="incomplete")
    db.add(row)
    db.commit()
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **_: _source(tenant_id))
    monkeypatch.setattr(settings, "stripe_webhook_secret", "synthetic-webhook")
    payload = json.dumps({"id": "evt_wrong_initial_customer", "type": "invoice.paid", "livemode": False,
                          "created": int(datetime.now(UTC).timestamp()), "data": {"object": {
                              "id": "in_plan", "subscription": "sub_plan", "customer": "cus_plan",
                              "livemode": False, "metadata": {}}}}).encode()
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload, "synthetic-webhook")})
    assert response.status_code == 403
    db.refresh(row)
    assert row.stripe_customer_id == "cus_existing" and row.stripe_subscription_id is None
    assert row.status == "incomplete" and row.stripe_payment_watermark_at is None


def test_old_invoice_fallback_cannot_replace_the_current_paid_agreement(client, db, monkeypatch, new_owner):
    import json

    tenant_id = UUID(new_owner["tenant_id"])
    current = {**_source(tenant_id, "gestion"), "created": 200}
    row = _apply(db, monkeypatch, new_owner, current)
    old = {**_source(tenant_id), "id": "sub_old", "created": 100}
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **kwargs: deepcopy(
        old if kwargs["stripe_subscription_id"] == "sub_old" else current))
    monkeypatch.setattr(settings, "stripe_webhook_secret", "synthetic-webhook")
    payload = json.dumps({"id": "evt_previous_agreement_paid", "type": "invoice.paid", "livemode": False,
                          "created": int(datetime.now(UTC).timestamp()), "data": {"object": {
                              "id": "in_old", "subscription": "sub_old", "customer": "cus_plan",
                              "livemode": False, "metadata": {}}}}).encode()
    response = client.post("/api/v1/billing/webhooks/stripe", content=payload,
                           headers={"Stripe-Signature": _stripe_signature(payload, "synthetic-webhook")})
    assert response.status_code == 200 and response.json() == {"status": "ignored"}
    db.refresh(row)
    assert row.stripe_subscription_id == "sub_plan" and row.plan_code == "gestion"
    assert row.stripe_payment_watermark_at is None


class FakePortal:
    def __init__(self, *, update=False, wrong_customer=False):
        self.calls = []
        self.update = update
        self.wrong_customer = wrong_customer

    def retrieve_configuration(self, **kwargs):
        return {"id": kwargs["configuration_id"], "active": True, "livemode": False,
                "features": {"subscription_update": {"enabled": self.update}}}

    def create_session(self, **kwargs):
        self.calls.append(kwargs)
        return {"url": "https://billing.stripe.com/p/session/synthetic",
                "customer": "cus_other" if self.wrong_customer else kwargs["customer_id"],
                "configuration": kwargs["configuration_id"], "livemode": False}


@pytest.fixture
def portal_owner(client, db, monkeypatch, new_owner):
    row = _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    monkeypatch.setattr(settings, "billing_portal_enabled", True)
    monkeypatch.setattr(settings, "stripe_tiered_portal_configuration_id", "bpc_tiered")
    fake = FakePortal()
    monkeypatch.setattr(service, "portal_client", fake)
    return new_owner, row, fake


def test_portal_disabled_without_explicit_acceptance(client, db, monkeypatch, new_owner):
    _apply(db, monkeypatch, new_owner, _source(new_owner["tenant_id"]))
    monkeypatch.setattr(settings, "billing_portal_enabled", False)
    assert client.get("/api/v1/billing/subscription").json()["portal_available"] is False
    assert client.post("/api/v1/billing/portal").status_code == 503


def test_portal_customer_and_return_url_are_server_owned(client, monkeypatch, portal_owner):
    _, row, fake = portal_owner
    monkeypatch.setattr(settings, "frontend_url", "https://app.test")
    response = client.post("/api/v1/billing/portal",
                           json={"customer_id": "cus_injected", "return_url": "https://evil.test"})
    assert response.status_code == 200, response.text
    assert fake.calls[0]["customer_id"] == row.stripe_customer_id
    assert fake.calls[0]["return_url"] == "https://app.test/settings/billing"
    assert response.json()["portal_url"].startswith("https://billing.stripe.com/")


def test_portal_rejects_mismatched_customer(client, monkeypatch, portal_owner):
    monkeypatch.setattr(service, "portal_client", FakePortal(wrong_customer=True))
    assert client.post("/api/v1/billing/portal").status_code == 502


def test_cashier_cannot_open_owner_portal(client, db, portal_owner):
    signup, _, fake = portal_owner
    _set_role(db, signup, "cashier")
    assert client.post("/api/v1/billing/portal").status_code == 403
    assert not fake.calls


def test_billing_read_permission_cannot_open_a_portal_with_write_capabilities(
    client, db, monkeypatch, portal_owner,
):
    from app.rbac.permissions import ROLE_PERMISSIONS, Permission

    signup, _, fake = portal_owner
    monkeypatch.setitem(ROLE_PERMISSIONS, "manager", {Permission.BILLING_VIEW})
    _set_role(db, signup, "manager")
    assert client.get("/api/v1/billing/subscription").status_code == 200
    assert client.post("/api/v1/billing/portal").status_code == 403
    assert not fake.calls


def test_standard_portal_cannot_change_legacy_agreement(client, db, monkeypatch, portal_owner):
    signup, _, _ = portal_owner
    db.get(Tenant, UUID(signup["tenant_id"])).billing_cohort = "standard"
    db.commit()
    monkeypatch.setattr(settings, "stripe_standard_portal_configuration_id", "bpc_standard")
    fake = FakePortal(update=True)
    monkeypatch.setattr(service, "portal_client", fake)
    assert client.post("/api/v1/billing/portal").status_code == 503
    assert not fake.calls


def test_tiered_portal_rejects_unknown_prices_and_immediate_downgrades(tiered_settings):
    from fastapi import HTTPException

    configuration = {
        "id": "bpc_tiered", "active": True, "livemode": False,
        "features": {"subscription_update": {
            "enabled": True, "default_allowed_updates": ["price"],
            "products": [{"product": "prod_kova", "prices": ["price_esencial", "price_gestion"]}],
            "proration_behavior": "always_invoice",
            "schedule_at_period_end": {"conditions": [{"type": "decreasing_item_amount"}]},
        }},
    }
    service._validate_portal_configuration(configuration, configuration_id="bpc_tiered", tiered=True)
    configuration["features"]["subscription_update"]["products"][0]["prices"].append("price_extra")
    with pytest.raises(HTTPException):
        service._validate_portal_configuration(
            configuration, configuration_id="bpc_tiered", tiered=True,
        )
    configuration["features"]["subscription_update"]["products"][0]["prices"].pop()
    configuration["features"]["subscription_update"]["schedule_at_period_end"]["conditions"] = []
    with pytest.raises(HTTPException):
        service._validate_portal_configuration(
            configuration, configuration_id="bpc_tiered", tiered=True,
        )

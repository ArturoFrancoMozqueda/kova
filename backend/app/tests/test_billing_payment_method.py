"""Portal defaults affect only the owned agreement, never entitlements."""

import copy
import json
from io import BytesIO
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.billing import service, stripe_client
from app.billing.models import Subscription, WebhookEvent
from app.billing.stripe_client import StripePaymentMethodClient, StripeSubscriptionError
from app.config import settings
from app.tenants.models import Tenant

_REAL_VERIFY = service.verify_stripe_signature


@pytest.fixture
def portal(db, monkeypatch):
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kw: None)
    monkeypatch.setattr(settings, "app_env", "local")
    monkeypatch.setattr(settings, "stripe_secret_key", "synthetic-key")
    tenant = Tenant(name="Portal default QA", slug=f"portal-{uuid4().hex}")
    db.add(tenant)
    db.flush()
    sub = Subscription(
        tenant_id=tenant.id,
        stripe_customer_id=f"cus_{uuid4().hex}",
        stripe_subscription_id=f"sub_{uuid4().hex}",
        status="active",
        plan_code="esencial",
        amount_minor_units=39900,
        cancel_at_period_end=True,
    )
    db.add(sub)
    db.commit()
    customer = {
        "id": sub.stripe_customer_id,
        "object": "customer",
        "livemode": False,
        "invoice_settings": {
            "default_payment_method": {
                "id": "pm_current",
                "object": "payment_method",
                "type": "card",
                "customer": sub.stripe_customer_id,
                "livemode": False,
            }
        },
    }
    remote = {
        "id": sub.stripe_subscription_id,
        "object": "subscription",
        "livemode": False,
        "customer": sub.stripe_customer_id,
        "metadata": {"tenant_id": str(tenant.id)},
        "status": "active",
        "default_payment_method": "pm_checkout",
    }
    writes = []

    def clear(**kwargs):
        writes.append(kwargs)
        remote["default_payment_method"] = None
        return copy.deepcopy(remote)

    monkeypatch.setattr(service.payment_method_client, "retrieve_customer", lambda **kw: customer)
    monkeypatch.setattr(service.subscription_client, "retrieve", lambda **kw: remote)
    monkeypatch.setattr(service.payment_method_client, "clear_subscription_override", clear)

    def process(event_id=None, **changes):
        obj = {
            "id": sub.stripe_customer_id,
            "object": "customer",
            "livemode": False,
            "metadata": {"tenant_id": str(uuid4())},
            "invoice_settings": {"default_payment_method": "pm_stale"},
        }
        event = {
            "id": event_id or f"evt_{uuid4().hex}",
            "type": "customer.updated",
            "livemode": False,
            "data": {
                "object": obj,
                "previous_attributes": {
                    "invoice_settings": {"default_payment_method": "pm_previous"}
                },
            },
        }
        event.update(changes)
        return service.process_stripe_webhook(
            db, payload=json.dumps(event).encode(), signature_header="unused"
        )

    return sub, customer, remote, writes, process


def test_default_changes_effective_method_only_and_redelivery_is_idempotent(db, portal):
    sub, customer, remote, writes, process = portal
    assert process("evt_default") == {"status": "processed"}
    assert process("evt_default") == {"status": "processed"}
    assert len(writes) == 1
    assert writes[0]["subscription_id"] == sub.stripe_subscription_id
    assert writes[0]["idempotency_key"].startswith("kova-portal-default-")
    assert remote["default_payment_method"] is None
    assert customer["invoice_settings"]["default_payment_method"]["id"] == "pm_current"
    db.refresh(sub)
    assert (sub.status, sub.plan_code, sub.amount_minor_units, sub.cancel_at_period_end) == (
        "active",
        "esencial",
        39900,
        True,
    )
    assert sub.stripe_payment_watermark_at is None
    assert sub.stripe_lifecycle_watermark_at is None
    assert (
        db.query(WebhookEvent).filter_by(stripe_event_id="evt_default").one().tenant_id
        == sub.tenant_id
    )


@pytest.mark.parametrize(
    "field",
    [
        "customer_mode",
        "subscription_mode",
        "subscription_owner",
        "subscription_id",
        "metadata_owner",
        "method_owner",
        "method_mode",
        "method_type",
        "method_string",
        "event_mode",
    ],
)
def test_unverified_provider_objects_never_change_agreement(db, portal, field):
    sub, customer, remote, writes, process = portal
    method = customer["invoice_settings"]["default_payment_method"]
    changes = {}
    if field == "customer_mode":
        customer["livemode"] = True
    elif field == "subscription_mode":
        remote["livemode"] = True
    elif field == "subscription_owner":
        remote["customer"] = "cus_other"
    elif field == "subscription_id":
        remote["id"] = "sub_other"
    elif field == "metadata_owner":
        remote["metadata"]["tenant_id"] = str(uuid4())
    elif field == "method_owner":
        method["customer"] = "cus_other"
    elif field == "method_mode":
        method["livemode"] = True
    elif field == "method_type":
        method["type"] = "us_bank_account"
    elif field == "method_string":
        customer["invoice_settings"]["default_payment_method"] = "pm_unexpanded"
    elif field == "event_mode":
        changes["livemode"] = True
    with pytest.raises(HTTPException):
        process(**changes)
    assert writes == []
    db.refresh(sub)
    assert sub.status == "active"


@pytest.mark.parametrize(
    "case", ["no_override", "no_default", "canceled", "legacy_metadata", "unrelated", "unknown"]
)
def test_unrelated_changes_are_ignored_and_bound_legacy_agreement_supported(db, portal, case):
    sub, customer, remote, writes, process = portal
    changes = {}
    if case == "no_override":
        remote["default_payment_method"] = None
    elif case == "no_default":
        customer["invoice_settings"]["default_payment_method"] = None
    elif case == "canceled":
        remote["status"] = "canceled"
    elif case == "legacy_metadata":
        remote["metadata"] = {}
    elif case == "unrelated":
        changes["data"] = {
            "object": customer,
            "previous_attributes": {"email": "old@example.invalid"},
        }
    elif case == "unknown":
        changes["data"] = {
            "object": {**customer, "id": "cus_unknown"},
            "previous_attributes": {"invoice_settings": {"default_payment_method": None}},
        }
    assert process(**changes) == {
        "status": "processed" if case in {"no_override", "legacy_metadata"} else "ignored"
    }
    assert len(writes) == (1 if case == "legacy_metadata" else 0)


def test_missing_key_and_transient_failure_allow_safe_redelivery(db, portal, monkeypatch):
    sub, customer, remote, writes, process = portal
    monkeypatch.setattr(settings, "stripe_secret_key", None)
    with pytest.raises(HTTPException):
        process("evt_retry")
    assert writes == []
    monkeypatch.setattr(settings, "stripe_secret_key", "synthetic-key")

    def unavailable(**kw):
        raise StripeSubscriptionError("Unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(service.payment_method_client, "clear_subscription_override", unavailable)
        with pytest.raises(StripeSubscriptionError):
            process("evt_retry")
    assert process("evt_retry") == {"status": "processed"}
    assert len(writes) == 1


def test_client_only_clears_override_without_charging_or_changing_price(monkeypatch):
    requests = []

    def respond(request, **kwargs):
        requests.append(request)
        assert kwargs == {"timeout": 10}
        return BytesIO(b"{}")

    monkeypatch.setattr(stripe_client, "urlopen", respond)
    client = StripePaymentMethodClient()
    client.retrieve_customer(secret_key="synthetic-key", customer_id="cus_synthetic")
    client.clear_subscription_override(
        secret_key="synthetic-key",
        subscription_id="sub_synthetic",
        idempotency_key="synthetic-idempotency",
    )
    assert parse_qs(urlsplit(requests[0].full_url).query) == {
        "expand[]": ["invoice_settings.default_payment_method"]
    }
    assert requests[1].get_method() == "POST"
    assert parse_qs(requests[1].data.decode(), keep_blank_values=True) == {
        "default_payment_method": [""]
    }
    assert requests[1].headers["Idempotency-key"] == "synthetic-idempotency"


@pytest.mark.parametrize("failure", ["http", "json", "size", "array"])
def test_client_errors_do_not_retain_private_response(monkeypatch, failure):
    def respond(request, **kwargs):
        if failure == "http":
            raise HTTPError(request.full_url, 400, "private", {}, BytesIO(b"NEVER_PERSIST"))
        return BytesIO(
            {"json": b"NEVER_PERSIST", "size": b"x" * 1_048_577, "array": b"[]"}[failure]
        )

    monkeypatch.setattr(stripe_client, "urlopen", respond)
    with pytest.raises(StripeSubscriptionError) as exc:
        StripePaymentMethodClient().retrieve_customer(
            secret_key="synthetic-key", customer_id="cus_synthetic"
        )
    assert "NEVER_PERSIST" not in str(exc.value)


def test_unconfirmed_provider_write_is_failed_not_marked_processed(db, portal, monkeypatch):
    sub, customer, remote, writes, process = portal
    monkeypatch.setattr(
        service.payment_method_client, "clear_subscription_override", lambda **kw: remote
    )
    with pytest.raises(StripeSubscriptionError):
        process("evt_unconfirmed")
    assert (
        db.query(WebhookEvent).filter_by(stripe_event_id="evt_unconfirmed").one().processing_status
        == "failed"
    )


def test_customer_default_handler_still_requires_signature_and_live_mode(
    client, portal, monkeypatch
):
    sub, customer, remote, writes, process = portal
    # Restore the real verifier; synthetic payloads never call provider writes.
    monkeypatch.setattr(service, "verify_stripe_signature", _REAL_VERIFY)
    response = client.post(
        "/api/v1/billing/webhooks/stripe",
        json={
            "id": "evt_unsigned_default",
            "type": "customer.updated",
            "livemode": True,
            "data": {
                "object": customer,
                "previous_attributes": {"invoice_settings": {"default_payment_method": None}},
            },
        },
    )
    assert response.status_code in {400, 503}
    assert writes == []
    monkeypatch.setattr(service, "verify_stripe_signature", lambda **kw: None)
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    with pytest.raises(HTTPException) as exc:
        process("evt_test_default")
    assert exc.value.status_code == 400
    assert writes == []

from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.billing import access, service
from app.billing.models import Subscription


@pytest.mark.parametrize("remaining_days", [None, -1, 30])
def test_courtesy_trial_requires_a_future_expiration(monkeypatch, remaining_days):
    tenant_id = uuid4()
    end = (
        datetime.now(UTC) + timedelta(days=remaining_days)
        if remaining_days is not None else None
    )
    subscription = Subscription(tenant_id=tenant_id, status="trialing", trial_ends_at=end)
    lookup = Mock(return_value=subscription)
    monkeypatch.setattr(access.billing_repo, "get_subscription_by_tenant", lookup)
    db = Mock()

    result = access.get_billing_access_status(db, tenant_id=tenant_id)

    lookup.assert_called_once_with(db, tenant_id=tenant_id)
    assert result.allowed is (remaining_days == 30)
    assert result.reason == ("trialing" if remaining_days == 30 else "trial_expired")
    assert result.trial_ends_at == end
    assert result.recovery_path == "/settings/billing"


def test_stripe_trial_keeps_its_webhook_managed_access_policy(monkeypatch):
    subscription = Subscription(
        tenant_id=uuid4(), status="trialing", stripe_subscription_id="sub_test_trial",
        trial_ends_at=datetime.now(UTC) - timedelta(days=1),
    )
    monkeypatch.setattr(
        access.billing_repo, "get_subscription_by_tenant", Mock(return_value=subscription)
    )

    result = access.get_billing_access_status(Mock(), tenant_id=subscription.tenant_id)

    assert result.allowed
    assert result.reason == "trialing"


@pytest.mark.parametrize("stripe_subscription_id", [None, "sub_test_trial"])
def test_only_courtesy_trial_can_start_paid_checkout(monkeypatch, stripe_subscription_id):
    tenant_id = uuid4()
    subscription = Subscription(
        tenant_id=tenant_id, status="trialing", stripe_subscription_id=stripe_subscription_id,
        trial_ends_at=datetime.now(UTC) + timedelta(days=30),
    )
    monkeypatch.setattr(
        service.repository, "get_subscription_by_tenant", Mock(return_value=subscription)
    )
    monkeypatch.setattr(service, "_checkout_config", Mock(return_value=("test", "price", "ok", "cancel")))
    monkeypatch.setattr(service.idempotency_service, "claim", Mock(return_value=None))
    monkeypatch.setattr(service.idempotency_service, "store", Mock())
    monkeypatch.setattr(service.audit_service, "log", Mock())
    monkeypatch.setattr(service, "_validate_standard_price_configuration", Mock())
    monkeypatch.setattr(service, "_validate_live_checkout_session", Mock())
    checkout = Mock(return_value={"id": "cs_test_courtesy", "url": "https://checkout.stripe.test/courtesy"})
    monkeypatch.setattr(service.checkout_client, "create_checkout_session", checkout)
    db = Mock()
    kwargs = dict(tenant_id=tenant_id, user_id=uuid4(), idempotency_key="courtesy-upgrade")

    if stripe_subscription_id:
        with pytest.raises(HTTPException, match="already has an active subscription"):
            service.create_checkout_session(db, **kwargs)
        checkout.assert_not_called()
        db.commit.assert_not_called()
    else:
        status, body = service.create_checkout_session(db, **kwargs)
        assert status == 201
        assert body["checkout_session_id"] == "cs_test_courtesy"
        assert checkout.call_args.kwargs["tenant_id"] == str(tenant_id)
        db.commit.assert_called_once()
        assert subscription.status == "trialing"

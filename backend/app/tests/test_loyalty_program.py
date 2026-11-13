from uuid import uuid4

import pytest

from app.loyalty.models import (
    LoyaltyAppearance,
    LoyaltyEnrollmentPolicy,
    LoyaltyPolicyRevision,
    LoyaltyRewardRevision,
)
from app.tests.test_loyalty import setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/loyalty/program"


def body():
    return {
        "policy": {
            "expected_version": 0,
            "enabled": True,
            "spend_amount": "100.00",
            "points_per_step": 5,
        },
        "reward": {
            "expected_version": 0,
            "enabled": True,
            "title": "Tu recompensa",
            "points_cost": 100,
            "discount_amount": "25.00",
        },
        "reward_expected_version": 0,
        "enrollment": {"expected_version": 0, "enabled": True},
        "appearance": {"expected_version": 0, "color": "#f0eedd", "use_business_logo": True},
    }


def test_program_is_atomic_versioned_and_replay_safe(client, db):
    setup(client)
    assert client.get(BASE).json()["policy"]["spend_amount"] is None
    payload = body()
    key = str(uuid4())
    response = client.put(BASE, json=payload, headers={"Idempotency-Key": key})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["appearance"]["color"] == "#F0EEDD"
    assert client.put(BASE, json=payload, headers={"Idempotency-Key": key}).json() == saved
    assert (
        client.put(BASE, json=payload, headers={"Idempotency-Key": str(uuid4())}).status_code == 409
    )
    for model in (
        LoyaltyAppearance,
        LoyaltyPolicyRevision,
        LoyaltyEnrollmentPolicy,
        LoyaltyRewardRevision,
    ):
        assert db.query(model).count() == 1


def test_invalid_design_does_not_publish_any_partial_policy(client, db):
    setup(client)
    payload = body()
    payload["appearance"]["color"] = "url(https://bad.example)"
    assert (
        client.put(BASE, json=payload, headers={"Idempotency-Key": str(uuid4())}).status_code == 422
    )
    for model in (
        LoyaltyAppearance,
        LoyaltyPolicyRevision,
        LoyaltyEnrollmentPolicy,
        LoyaltyRewardRevision,
    ):
        assert db.query(model).count() == 0


def test_program_write_preserves_plan_and_owner_gates(client, db):
    from datetime import UTC, datetime, timedelta

    from app.auth.models import Membership
    from app.billing.models import Subscription
    from app.tenants.models import Tenant

    tenant, _ = setup(client)
    db.get(Tenant, tenant).billing_cohort = "tiered"
    subscription = Subscription(
        tenant_id=tenant,
        stripe_subscription_id="sub_test_program_gate",
        current_period_end=datetime.now(UTC) + timedelta(days=30),
    )
    db.add(subscription)
    subscription.status = "active"
    subscription.plan_code = "esencial"
    subscription.plan_effective_until = None
    db.commit()
    assert (
        client.put(BASE, json=body(), headers={"Idempotency-Key": str(uuid4())}).status_code == 403
    )
    subscription.plan_code = "gestion"
    membership = db.query(Membership).filter_by(tenant_id=tenant, role="owner").one()
    membership.role = "manager"
    db.commit()
    assert client.get(BASE).status_code == 403
    assert db.query(LoyaltyPolicyRevision).count() == 0

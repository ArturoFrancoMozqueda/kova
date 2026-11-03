"""A stale commercial offer cannot create or recover an account under different prices."""

from dataclasses import replace
from uuid import UUID, uuid4

import pytest

from app.audit.models import AuditLog
from app.auth import service as auth_service
from app.auth.models import Membership, User, VerificationToken
from app.billing.offers import public_offer
from app.billing.plans import PLANS
from app.config import settings
from app.tenants.models import Tenant


@pytest.fixture
def offer_settings(monkeypatch):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    monkeypatch.setattr(settings, "stripe_secret_key", "synthetic-offer-key-never-sent")
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_synthetic_standard")
    monkeypatch.setattr(settings, "stripe_esencial_price_id", "price_synthetic_esencial")
    monkeypatch.setattr(settings, "stripe_gestion_price_id", "price_synthetic_gestion")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")


@pytest.fixture
def sent_verifications(monkeypatch):
    sent = []
    monkeypatch.setattr(auth_service.email_service, "send_verification_email",
                        lambda **kwargs: sent.append(kwargs))
    return sent


def _body(**extra):
    return {
        "email": f"offer-{uuid4().hex}@example.com", "password": "S3cur3pass!",
        "tenant_name": "Oferta revisada", "accepted_terms": True, **extra,
    }


def _counts(db):
    return (
        db.query(User).count(), db.query(Tenant).count(), db.query(Membership).count(),
        db.query(VerificationToken).count(),
        db.query(AuditLog).filter(AuditLog.action.like("user.signup%")).count(),
    )


def _assert_offer_changed(response):
    assert response.status_code == 409, response.text
    assert "Revisa los precios actualizados" in response.json()["detail"]


def test_revision_is_stable_and_distinguishes_cohorts_without_provider_configuration():
    legacy = public_offer(tiered=False)
    new = public_offer(tiered=True)
    assert legacy == public_offer(tiered=False)
    assert new == public_offer(tiered=True)
    assert legacy["offer_revision"] != new["offer_revision"]
    assert legacy["offer_revision"].startswith("offer-v1-")
    assert [plan["code"] for plan in legacy["available_plans"]] == ["standard"]
    assert [plan["code"] for plan in new["available_plans"]] == ["esencial", "gestion"]


@pytest.mark.parametrize("changes", [
    {"amount_minor_units": 49900}, {"features": ("pos",)}, {"product_image_bytes": 500_000_000},
])
def test_revision_changes_when_the_displayed_commercial_catalog_changes(monkeypatch, changes):
    before = public_offer(tiered=True)["offer_revision"]
    monkeypatch.setitem(PLANS, "esencial", replace(PLANS["esencial"], **changes))
    assert public_offer(tiered=True)["offer_revision"] != before


def test_legacy_signup_without_revision_stays_compatible_when_offer_is_off(
    client, db, offer_settings, sent_verifications,
):
    offer = client.get("/api/v1/billing/plans")
    assert offer.status_code == 200, offer.text
    assert offer.json()["offer_revision"] == public_offer(tiered=False)["offer_revision"]
    result = client.post("/api/v1/auth/signup", json=_body())
    assert result.status_code == 201, result.text
    tenant = db.get(Tenant, UUID(result.json()["tenant_id"]))
    assert tenant.billing_cohort == "standard"
    assert len(sent_verifications) == 1


@pytest.mark.parametrize("revision", [None, "", "stale-public-offer"])
def test_tiered_signup_requires_current_offer_before_any_account_side_effect(
    client, db, monkeypatch, offer_settings, sent_verifications, revision,
):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    before = _counts(db)
    body = _body()
    if revision is not None:
        body["billing_offer_revision"] = revision
    _assert_offer_changed(client.post("/api/v1/auth/signup", json=body))
    assert _counts(db) == before
    assert sent_verifications == []


def test_activation_between_price_view_and_signup_requires_a_new_review(
    client, db, monkeypatch, offer_settings, sent_verifications,
):
    viewed = client.get("/api/v1/billing/plans").json()
    assert viewed["available_plans"][0]["amount_minor_units"] == 29900
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    before = _counts(db)
    body = _body(billing_offer_revision=viewed["offer_revision"])
    _assert_offer_changed(client.post("/api/v1/auth/signup", json=body))
    assert _counts(db) == before
    assert sent_verifications == []

    refreshed = client.get("/api/v1/billing/plans").json()
    assert refreshed["offer_revision"] != viewed["offer_revision"]
    result = client.post("/api/v1/auth/signup", json={
        **body, "billing_offer_revision": refreshed["offer_revision"],
    })
    assert result.status_code == 201, result.text
    assert db.get(Tenant, UUID(result.json()["tenant_id"])).billing_cohort == "tiered"
    assert len(sent_verifications) == 1


def test_catalog_change_between_view_and_signup_does_not_create_a_business(
    client, db, monkeypatch, offer_settings, sent_verifications,
):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    viewed = client.get("/api/v1/billing/plans").json()
    monkeypatch.setitem(PLANS, "esencial", replace(PLANS["esencial"], features=("pos",)))
    before = _counts(db)
    _assert_offer_changed(client.post("/api/v1/auth/signup", json=_body(
        billing_offer_revision=viewed["offer_revision"],
    )))
    assert _counts(db) == before
    assert sent_verifications == []


def test_offer_rollback_rejects_a_supplied_stale_revision_but_keeps_legacy_signup(
    client, db, monkeypatch, offer_settings, sent_verifications,
):
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    viewed = client.get("/api/v1/billing/plans").json()
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", False)
    before = _counts(db)
    body = _body()
    _assert_offer_changed(client.post("/api/v1/auth/signup", json={
        **body, "billing_offer_revision": viewed["offer_revision"],
    }))
    assert _counts(db) == before
    assert sent_verifications == []
    # Older Standard clients did not have this field and remain supported while off.
    created = client.post("/api/v1/auth/signup", json=body)
    assert created.status_code == 201, created.text
    assert db.get(Tenant, UUID(created.json()["tenant_id"])).billing_cohort == "standard"


@pytest.mark.parametrize("verified", [False, True])
def test_stale_offer_does_not_resend_or_disclose_an_existing_account(
    client, db, monkeypatch, offer_settings, sent_verifications, verified,
):
    body = _body()
    created = client.post("/api/v1/auth/signup", json=body)
    assert created.status_code == 201, created.text
    if verified:
        result = client.post("/api/v1/auth/verify", json={
            "token": created.json()["dev_verification_token"],
        })
        assert result.status_code == 200, result.text
    before = _counts(db)
    sent_verifications.clear()
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    rejected = client.post("/api/v1/auth/signup", json=body)
    _assert_offer_changed(rejected)
    unknown = client.post("/api/v1/auth/signup", json=_body())
    assert unknown.status_code == 409
    assert unknown.json() == rejected.json()
    assert _counts(db) == before
    assert sent_verifications == []


def test_refreshed_offer_recovers_a_pending_standard_account_without_migrating_it(
    client, db, monkeypatch, offer_settings, sent_verifications,
):
    body = _body()
    created = client.post("/api/v1/auth/signup", json=body)
    assert created.status_code == 201, created.text
    tenant_id = UUID(created.json()["tenant_id"])
    before = db.query(Tenant).count()
    monkeypatch.setattr(settings, "billing_tiered_plans_enabled", True)
    current = client.get("/api/v1/billing/plans").json()
    resent = client.post("/api/v1/auth/signup", json={
        **body, "billing_offer_revision": current["offer_revision"],
    })
    assert resent.status_code == 201, resent.text
    assert db.query(Tenant).count() == before
    assert db.get(Tenant, tenant_id).billing_cohort == "standard"
    assert len(sent_verifications) == 2
    old = client.post("/api/v1/auth/verify", json={
        "token": created.json()["dev_verification_token"],
    })
    assert old.status_code == 400, old.text


def test_one_offer_snapshot_controls_validation_and_the_created_cohort(
    client, db, monkeypatch, offer_settings, sent_verifications,
):
    # Model a rollout source changing after it is read. Validation and cohort
    # assignment must use one decision, rather than sampling it a second time.
    decisions = iter((True, False))
    monkeypatch.setattr(auth_service, "tiered_pricing_enabled", lambda: next(decisions))
    result = client.post("/api/v1/auth/signup", json=_body(
        billing_offer_revision=public_offer(tiered=True)["offer_revision"],
    ))
    assert result.status_code == 201, result.text
    assert db.get(Tenant, UUID(result.json()["tenant_id"])).billing_cohort == "tiered"
    assert next(decisions) is False
    assert len(sent_verifications) == 1

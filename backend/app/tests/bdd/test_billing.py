import hashlib
import hmac
import json
import time
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from pytest_bdd import given, scenario, then, when
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.billing import service as billing_service
from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.main import app

# ─── Scenario declarations ───────────────────────────────────────────────────

@scenario("../../../../specs/billing/billing.feature", "Tenant owner starts checkout for the Standard Plan")
def test_tenant_owner_starts_checkout():
    pass


@scenario("../../../../specs/billing/billing.feature", "Tenant returns from successful checkout")
def test_tenant_returns_from_successful_checkout():
    pass


@scenario("../../../../specs/billing/billing.feature", "Stripe webhook activates a subscription idempotently")
def test_stripe_webhook_activates_subscription_idempotently():
    pass


@scenario("../../../../specs/billing/billing.feature", "Duplicate Stripe webhook does not duplicate side effects")
def test_duplicate_stripe_webhook_no_side_effects():
    pass


@scenario("../../../../specs/billing/billing.feature", "Past due tenant sees recovery guidance")
def test_past_due_tenant_sees_recovery_guidance():
    pass


@scenario("../../../../specs/billing/billing.feature", "Tenant owner cancels subscription")
def test_tenant_owner_cancels_subscription():
    pass


@scenario("../../../../specs/billing/billing.feature", "Non-owner cannot manage billing")
def test_non_owner_cannot_manage_billing():
    pass


@scenario("../../../../specs/billing/billing.feature", "Tenant isolation for billing")
def test_tenant_isolation_for_billing():
    pass


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _signup_verify_login(client: TestClient, email: str, tenant_name: str) -> dict:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    signup = r.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text
    return signup


def _set_role(db: Session, signup: dict, role: str) -> None:
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = role
    db.commit()


def _configure_stripe(monkeypatch, fake_checkout=None, fake_subscription=None) -> None:
    if fake_checkout is not None:
        monkeypatch.setattr(billing_service, "checkout_client", fake_checkout)
    if fake_subscription is not None:
        monkeypatch.setattr(billing_service, "subscription_client", fake_subscription)
    monkeypatch.setattr(billing_service, "price_client", _FakePriceClient())
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_123")
    monkeypatch.setattr(settings, "stripe_standard_price_id", "price_standard_299_mxn")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "http://localhost:5173/billing/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "http://localhost:5173/billing/cancel")


def _stripe_signature(payload: bytes, secret: str = "whsec_test_123") -> str:
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    digest = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _stripe_event(event_type: str, stripe_object: dict) -> bytes:
    return json.dumps(
        {"id": f"evt_{uuid4().hex}", "type": event_type, "data": {"object": stripe_object}},
        separators=(",", ":"),
    ).encode()


class _FakePriceClient:
    def retrieve_price(self, **_kwargs) -> dict:
        return {
            "id": "price_standard_299_mxn",
            "active": True,
            "unit_amount": 29900,
            "currency": "mxn",
            "recurring": {"interval": "month"},
        }


class _FakeCheckoutClient:
    def __init__(self):
        self.calls: list[dict] = []

    def create_checkout_session(self, **kwargs) -> dict:
        self.calls.append(kwargs)
        return {"id": "cs_bdd_test", "url": "https://checkout.stripe.test/cs_bdd_test"}


class _FakeSubscriptionClient:
    def __init__(self):
        self.calls: list[dict] = []

    def update_cancel_at_period_end(self, **kwargs) -> dict:
        self.calls.append(kwargs)
        return {
            "id": kwargs["stripe_subscription_id"],
            "status": "active",
            "cancel_at_period_end": True,
            "current_period_start": 1_700_000_000,
            "current_period_end": 1_702_592_000,
            "canceled_at": None,
        }


# ─── Scenario 1: Tenant owner starts checkout ────────────────────────────────

@given("an authenticated tenant owner with billing management permission", target_fixture="billing_context")
def auth_owner_with_billing_permission(client, db, monkeypatch):  # noqa: ARG001
    fake_checkout = _FakeCheckoutClient()
    _configure_stripe(monkeypatch, fake_checkout=fake_checkout)
    signup = _signup_verify_login(client, f"bdd-checkout-{uuid4().hex}@example.com", "BDD Checkout")
    return {"client": client, "signup": signup, "fake_checkout": fake_checkout}


@when("the owner starts Standard Plan checkout")
def owner_starts_checkout(billing_context):
    r = billing_context["client"].post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "bdd-checkout-start"},
    )
    billing_context["checkout_response"] = r


@then("a Stripe Checkout URL is returned for the $299 MXN monthly plan")
def stripe_checkout_url_returned(billing_context):
    r = billing_context["checkout_response"]
    assert r.status_code == 201, r.text
    body = r.json()
    assert "checkout_url" in body
    assert body["checkout_url"].startswith("https://")
    assert billing_context["fake_checkout"].calls[0]["price_id"] == "price_standard_299_mxn"


# ─── Scenario 2: Tenant returns from successful checkout ─────────────────────

@given("an authenticated tenant owner has completed Stripe Checkout", target_fixture="post_checkout_context")
def owner_completed_stripe_checkout(client, db):
    signup = _signup_verify_login(
        client, f"bdd-post-checkout-{uuid4().hex}@example.com", "BDD Post Checkout"
    )
    subscription = Subscription(
        tenant_id=UUID(signup["tenant_id"]),
        stripe_customer_id="cus_bdd_post",
        stripe_subscription_id="sub_bdd_post",
        stripe_price_id="price_standard_299_mxn",
        status="active",
    )
    db.add(subscription)
    db.commit()
    return {"client": client}


@when("the owner opens billing settings")
def owner_opens_billing_settings(post_checkout_context):
    r = post_checkout_context["client"].get("/api/v1/billing/subscription")
    post_checkout_context["billing_response"] = r


@then("the UI shows the current subscription confirmation state")
def ui_shows_subscription_confirmation(post_checkout_context):
    r = post_checkout_context["billing_response"]
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subscription"] is not None
    assert body["subscription"]["status"] == "active"


# ─── Scenario 3: Stripe webhook activates a subscription idempotently ────────

@given("Stripe sends a verified checkout completion event for a tenant", target_fixture="webhook_context")
def stripe_sends_checkout_completion(client, db, monkeypatch):  # noqa: ARG001
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(client, f"bdd-webhook-{uuid4().hex}@example.com", "BDD Webhook")
    payload = _stripe_event(
        "checkout.session.completed",
        {
            "id": "cs_bdd_completed",
            "object": "checkout.session",
            "customer": "cus_bdd_completed",
            "subscription": "sub_bdd_completed",
            "metadata": {"tenant_id": signup["tenant_id"]},
        },
    )
    return {"client": client, "db": db, "signup": signup, "payload": payload}


@when("the webhook is processed")
def webhook_is_processed(webhook_context):
    payload = webhook_context["payload"]
    r = webhook_context["client"].post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )
    webhook_context["webhook_response"] = r


@then("the tenant subscription is active")
def tenant_subscription_is_active(webhook_context):
    assert webhook_context["webhook_response"].status_code == 200, webhook_context["webhook_response"].text
    subscription = (
        webhook_context["db"].query(Subscription)
        .filter(Subscription.tenant_id == UUID(webhook_context["signup"]["tenant_id"]))
        .one()
    )
    assert subscription.status == "active"
    assert subscription.stripe_subscription_id == "sub_bdd_completed"


# ─── Scenario 4: Duplicate Stripe webhook does not duplicate side effects ─────

@given("a Stripe event has already been processed", target_fixture="dup_webhook_context")
def stripe_event_already_processed(client, db, monkeypatch):  # noqa: ARG001
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(
        client, f"bdd-dup-webhook-{uuid4().hex}@example.com", "BDD Dup Webhook"
    )
    payload = _stripe_event(
        "checkout.session.completed",
        {
            "id": "cs_bdd_dup",
            "object": "checkout.session",
            "customer": "cus_bdd_dup",
            "subscription": "sub_bdd_dup",
            "metadata": {"tenant_id": signup["tenant_id"]},
        },
    )
    first = client.post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )
    assert first.status_code == 200, first.text
    return {"client": client, "db": db, "signup": signup, "payload": payload}


@when("Stripe delivers the same event again")
def stripe_delivers_same_event_again(dup_webhook_context):
    payload = dup_webhook_context["payload"]
    r = dup_webhook_context["client"].post(
        "/api/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload)},
    )
    dup_webhook_context["replay_response"] = r


@then("the webhook returns success without duplicating subscription updates or audit logs")
def webhook_idempotent_no_duplicates(dup_webhook_context):
    assert dup_webhook_context["replay_response"].status_code == 200
    event_id = json.loads(dup_webhook_context["payload"])["id"]
    events = (
        dup_webhook_context["db"].query(WebhookEvent)
        .filter(WebhookEvent.stripe_event_id == event_id)
        .all()
    )
    assert len(events) == 1
    audit_count = (
        dup_webhook_context["db"].query(AuditLog)
        .filter(
            AuditLog.tenant_id == UUID(dup_webhook_context["signup"]["tenant_id"]),
            AuditLog.action == "billing.subscription_activated",
        )
        .count()
    )
    assert audit_count == 1


# ─── Scenario 5: Past due tenant sees recovery guidance ──────────────────────

@given("Stripe has reported a failed subscription payment", target_fixture="past_due_context")
def stripe_reported_failed_payment(client, db, monkeypatch):  # noqa: ARG001
    _configure_stripe(monkeypatch)
    signup = _signup_verify_login(
        client, f"bdd-past-due-{uuid4().hex}@example.com", "BDD Past Due"
    )
    subscription = Subscription(
        tenant_id=UUID(signup["tenant_id"]),
        stripe_subscription_id="sub_bdd_past_due",
        status="past_due",
    )
    db.add(subscription)
    db.commit()
    return {"client": client}


@when("a tenant user opens the app")
def tenant_user_opens_app(past_due_context):
    r = past_due_context["client"].get("/api/v1/billing/subscription")
    past_due_context["subscription_response"] = r


@then("a past due billing banner is shown with recovery guidance")
def past_due_billing_banner_shown(past_due_context):
    r = past_due_context["subscription_response"]
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subscription"] is not None
    assert body["subscription"]["status"] == "past_due"


# ─── Scenario 6: Tenant owner cancels subscription ───────────────────────────

@given("an authenticated tenant owner has an active subscription", target_fixture="cancel_context")
def owner_with_active_subscription(client, db, monkeypatch):  # noqa: ARG001
    fake_sub = _FakeSubscriptionClient()
    _configure_stripe(monkeypatch, fake_subscription=fake_sub)
    signup = _signup_verify_login(
        client, f"bdd-cancel-{uuid4().hex}@example.com", "BDD Cancel"
    )
    subscription = Subscription(
        tenant_id=UUID(signup["tenant_id"]),
        stripe_subscription_id="sub_bdd_cancel",
        status="active",
    )
    db.add(subscription)
    db.commit()
    return {"client": client, "fake_sub": fake_sub}


@when("the owner requests cancellation")
def owner_requests_cancellation(cancel_context):
    r = cancel_context["client"].post("/api/v1/billing/cancel")
    cancel_context["cancel_response"] = r


@then("the subscription is marked to cancel according to Stripe Billing state")
def subscription_marked_to_cancel(cancel_context):
    r = cancel_context["cancel_response"]
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subscription"]["cancel_at_period_end"] is True
    assert cancel_context["fake_sub"].calls[0]["stripe_subscription_id"] == "sub_bdd_cancel"


# ─── Scenario 7: Non-owner cannot manage billing ─────────────────────────────

@given("an authenticated cashier without billing management permission", target_fixture="cashier_billing_context")
def cashier_without_billing_permission(client, db, monkeypatch):
    _configure_stripe(monkeypatch, fake_checkout=_FakeCheckoutClient())
    email = f"bdd-cashier-billing-{uuid4().hex}@example.com"
    signup = _signup_verify_login(client, email, "BDD Cashier Billing")
    _set_role(db, signup, "cashier")
    client.post("/api/v1/auth/logout")
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text
    return {"client": client}


@when("the cashier tries to start checkout or cancel subscription")
def cashier_tries_checkout_or_cancel(cashier_billing_context):
    r = cashier_billing_context["client"].post(
        "/api/v1/billing/checkout",
        headers={"Idempotency-Key": "bdd-cashier-checkout"},
    )
    cashier_billing_context["checkout_response"] = r


@then("a 403 error is returned")
def billing_403_error_returned(cashier_billing_context):
    assert cashier_billing_context["checkout_response"].status_code == 403


# ─── Scenario 8: Tenant isolation for billing ────────────────────────────────

@given("tenant A has an active subscription", target_fixture="billing_isolation_context")
def tenant_a_has_active_subscription(db):
    client_a = TestClient(app)
    client_b = TestClient(app)
    suffix = uuid4().hex
    signup_a = _signup_verify_login(client_a, f"bdd-billing-a-{suffix}@example.com", "Billing Tenant A")
    _signup_verify_login(client_b, f"bdd-billing-b-{suffix}@example.com", "Billing Tenant B")
    subscription = Subscription(
        tenant_id=UUID(signup_a["tenant_id"]),
        stripe_customer_id=f"cus_a_{suffix}",
        stripe_subscription_id=f"sub_a_{suffix}",
        status="active",
    )
    db.add(subscription)
    db.commit()
    return {"client_b": client_b}


@when("tenant B requests billing status")
def tenant_b_requests_billing_status(billing_isolation_context):
    r = billing_isolation_context["client_b"].get("/api/v1/billing/subscription")
    billing_isolation_context["tenant_b_response"] = r


@then("tenant A's subscription is not returned")
def tenant_a_subscription_not_returned(billing_isolation_context):
    r = billing_isolation_context["tenant_b_response"]
    assert r.status_code == 200, r.text
    assert r.json()["subscription"] is None

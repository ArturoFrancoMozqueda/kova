"""Internal ops dashboard — local KPI aggregation tests.

These prove the ops queries read ACROSS tenants (RLS exemption), that MRR only
counts active subscriptions, and that responses never carry secrets.
"""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.auth.models import User
from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.orders.models import Order
from app.telemetry.models import TelemetryEvent
from app.tenants.models import Tenant
from app.tests.test_ops_auth import _signup_login

ADMIN = "kpi-ceo@ops-test.com"


def _login_admin(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_admin_emails", ADMIN)
    _signup_login(client, ADMIN, "KPI HQ")


def _mk_tenant(db, name: str) -> Tenant:
    tenant = Tenant(id=uuid4(), name=name, slug=f"{name.lower().replace(' ', '-')}-{uuid4().hex[:6]}")
    db.add(tenant)
    db.flush()
    return tenant


def _mk_subscription(db, tenant_id, *, status: str, amount: int = 29_900, **kwargs) -> None:
    db.add(
        Subscription(
            id=uuid4(),
            tenant_id=tenant_id,
            status=status,
            amount_minor_units=amount,
            currency="MXN",
            **kwargs,
        )
    )
    db.flush()


def _mk_order(db, tenant_id, *, total: str, when: datetime) -> None:
    db.add(
        Order(
            id=uuid4(),
            tenant_id=tenant_id,
            status="completed",
            subtotal_amount=total,
            total_amount=total,
            created_at=when,
        )
    )
    db.flush()


def test_mrr_counts_only_active_and_is_cross_tenant(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    t1 = _mk_tenant(db, "Active Co")
    t2 = _mk_tenant(db, "Trial Co")
    _mk_subscription(db, t1.id, status="active", amount=29_900)
    _mk_subscription(db, t2.id, status="trialing", amount=29_900)

    r = client.get("/api/v1/internal/ops/revenue")
    assert r.status_code == 200
    body = r.json()
    # Active-only MRR — the trialing sub must not be included.
    assert body["mrr_minor_units"] == 29_900
    assert body["trialing_mrr_minor_units"] == 29_900
    assert body["by_status"].get("active") == 1
    assert body["by_status"].get("trialing") == 1
    # Both tenants surfaced → RLS did not scope the read to one tenant.
    trial_names = {t["tenant_name"] for t in body["trials"]}
    assert "Trial Co" in trial_names


def test_past_due_listed_with_grace(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    t = _mk_tenant(db, "Overdue Co")
    now = datetime.now(UTC)
    _mk_subscription(
        db,
        t.id,
        status="past_due",
        past_due_at=now - timedelta(days=2),
        grace_period_ends_at=now - timedelta(days=1),
    )
    r = client.get("/api/v1/internal/ops/revenue")
    body = r.json()
    assert any(p["tenant_name"] == "Overdue Co" for p in body["past_due"])

    # grace already expired → overview risk should flag it.
    r = client.get("/api/v1/internal/ops/overview")
    assert r.json()["risk"]["grace_period_expired"] >= 1


def test_overview_operations_reflect_recent_orders(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    t = _mk_tenant(db, "Selling Co")
    _mk_order(db, t.id, total="150.00", when=datetime.now(UTC) - timedelta(hours=1))

    body = client.get("/api/v1/internal/ops/overview").json()
    assert body["operations"]["orders_24h"] >= 1
    # sales amount is a decimal string, never a float.
    assert isinstance(body["operations"]["sales_24h_amount"], str)
    assert body["money"]["currency"] == "MXN"


def test_tenant_search_accepts_exact_tenant_id(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    target = _mk_tenant(db, "Trace Target")
    _mk_tenant(db, "Another Tenant")

    body = client.get(
        "/api/v1/internal/ops/tenants", params={"search": str(target.id)}
    ).json()

    assert body["total"] == 1
    assert body["items"][0]["tenant_id"] == str(target.id)


def test_funnel_cohort_and_conversions(client, db, monkeypatch):
    _login_admin(client, monkeypatch)
    t = _mk_tenant(db, "Funnel Co")
    # telemetry_events.user_id is a FK → reuse an existing user (the admin).
    user_id = db.query(User.id).first()[0]
    db.add(
        TelemetryEvent(
            id=uuid4(),
            tenant_id=t.id,
            user_id=user_id,
            event_name="first_product_created",
            client_event_id=uuid4().hex,
            properties={},
            created_at=datetime.now(UTC),
        )
    )
    db.flush()

    r = client.get("/api/v1/internal/ops/funnel", params={"window": "30d"})
    assert r.status_code == 200
    body = r.json()
    assert body["window"] == "30d"
    step_names = [s["name"] for s in body["steps"]]
    assert step_names == [
        "signup",
        "email_verified",
        "first_product",
        "first_sale",
        "checkout_started",
        "paid",
    ]
    signup = next(s for s in body["steps"] if s["name"] == "signup")
    first_product = next(s for s in body["steps"] if s["name"] == "first_product")
    assert signup["count"] >= 1
    assert first_product["count"] >= 1
    # conversions use "from"/"to" keys
    assert body["conversions"][0]["from"] == "signup"


def test_webhook_failures_sanitized_and_no_secrets(client, db, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_supersecretkey123")
    _login_admin(client, monkeypatch)
    t = _mk_tenant(db, "Webhook Co")
    db.add(
        WebhookEvent(
            id=uuid4(),
            tenant_id=t.id,
            stripe_event_id="evt_fail_1",
            event_type="invoice.payment_failed",
            processing_status="failed",
            process_attempts=3,
            error_reason="card_declined",
            payload={
                "id": "evt_fail_1",
                "type": "invoice.payment_failed",
                "data": {
                    "object": {
                        "id": "in_1",
                        "customer": "cus_1",
                        "payment_method_details": {"card": {"number": "4242"}},
                    }
                },
            },
            created_at=datetime.now(UTC),
        )
    )
    db.flush()

    r = client.get("/api/v1/internal/ops/revenue")
    assert r.status_code == 200
    raw = r.text
    body = r.json()
    failures = body["webhook_health"]["recent_failures"]
    assert any(f["stripe_event_id"] == "evt_fail_1" for f in failures)
    # Deep link uses the /test dashboard prefix because key is sk_test_.
    assert any("/test/events/evt_fail_1" in (f["deep_link"] or "") for f in failures)
    # Never leak the secret key or raw card data anywhere in the response.
    assert "sk_test_supersecretkey123" not in raw
    assert "4242" not in raw
    assert "payment_method_details" not in raw

"""Synthetic risk evidence on real PostgreSQL; provider lookups are read-only doubles."""
import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.billing import repository, risk, service
from app.billing.models import Subscription, WebhookEvent
from app.billing.stripe_client import StripeRiskError
from app.config import settings
from app.db import set_tenant_context
from app.ops import incidents
from app.ops import repository as ops_repository
from app.ops import service as ops_service
from app.ops.connectors.base import not_configured
from app.ops.models import OpsIncidentState
from app.ops.sanitize import sanitize_webhook_payload
from app.tenants.models import Tenant


class SyntheticStripe:
    def __init__(self, subscriptions=("sub_risk_a",), *, paginated=False):
        self.subscriptions = subscriptions
        self.paginated = paginated
        self.calls = []

    def retrieve(self, *, secret_key, resource, object_id):
        self.calls.append((resource, object_id))
        value = {"id": object_id, "livemode": False, "customer": "cus_risk_a"}
        if resource == "charges":
            value["payment_intent"] = "pi_risk_a"
        if resource == "invoices":
            index = int(object_id.rsplit("_", 1)[1])
            value["parent"] = {"type": "subscription_details", "subscription_details": {
                "subscription": self.subscriptions[index]}}
        if resource == "subscriptions":
            value["status"] = "canceled"  # Must not mutate the local active subscription.
        return value

    def invoice_payments(self, *, secret_key, payment_intent, starting_after=None):
        self.calls.append(("payments", starting_after))
        rows = [{"id": f"inpay_risk_{i}", "invoice": f"in_risk_{i}", "status": "paid",
                 "payment": {"type": "payment_intent", "payment_intent": payment_intent}}
                for i in range(len(self.subscriptions))]
        if self.paginated:
            return {"data": rows[:1] if starting_after is None else rows[1:],
                    "has_more": starting_after is None and len(rows) > 1}
        return {"data": rows, "has_more": False}


@pytest.fixture
def stripe(monkeypatch):
    fake = SyntheticStripe()
    monkeypatch.setattr(risk, "client", fake)
    monkeypatch.setattr(settings, "stripe_secret_key", "synthetic-risk-read-key")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_risk_synthetic")
    return fake


def seed(db, suffix="a"):
    tenant = Tenant(id=uuid4(), name="Synthetic risk tenant", slug=f"risk-{uuid4().hex}")
    db.add(tenant)
    db.flush()
    subscription = Subscription(tenant_id=tenant.id, stripe_subscription_id=f"sub_risk_{suffix}",
                                stripe_customer_id=f"cus_risk_{suffix}", status="active")
    db.add(subscription)
    db.flush()
    return tenant, subscription


def event(kind="charge.dispute.created", **changes):
    obj = {"id": "ch_risk_a" if kind == "charge.refunded" else
                 "du_risk_a" if kind == "charge.dispute.created" else "issfr_risk_a",
           "charge": "ch_risk_a", "payment_intent": None, "amount": 69900,
           "amount_refunded": 1200, "currency": "mxn", "status": "needs_response",
           "reason": "fraudulent", "evidence_details": {"due_by": 1900000000},
           "metadata": {"tenant_id": str(uuid4()), "secret": "NEVER_PERSIST"},
           "billing_details": {"email": "never-persist@example.invalid"}}
    return {"id": f"evt_risk_{uuid4().hex}", "type": kind, "created": int(time.time()),
            "livemode": False, "data": {"object": obj}, **changes}


def deliver(db, payload):
    body = json.dumps(payload).encode()
    stamp = int(time.time())
    signature = hmac.new(b"whsec_risk_synthetic", f"{stamp}.".encode() + body,
                         hashlib.sha256).hexdigest()
    return service.process_stripe_webhook(db, payload=body,
                                         signature_header=f"t={stamp},v1={signature}")


@pytest.mark.parametrize("kind", sorted(risk.RISK_EVENTS))
def test_risk_is_durable_idempotent_sanitized_and_does_not_change_access(db, stripe, kind, caplog):
    tenant, sub = seed(db)
    payload = event(kind)
    before = (sub.status, sub.plan_code, sub.current_period_end, sub.past_due_at)
    assert deliver(db, payload) == {"status": "processed"}
    count = len(stripe.calls)
    assert deliver(db, payload) == {"status": "processed"}
    assert len(stripe.calls) == count
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.tenant_id == tenant.id
    assert row.process_attempts == 1
    if kind == "charge.dispute.created":
        assert row.payload["data"]["object"]["id"] == "du_risk_a"
    assert row.payload["risk_review"]["mapping"] == "matched"
    assert "NEVER_PERSIST" not in json.dumps(row.payload)
    assert "never-persist@example.invalid" not in json.dumps(row.payload)
    assert "never-persist" not in caplog.text
    assert db.query(AuditLog).filter(AuditLog.resource_id == row.id).count() == 1
    db.refresh(sub)
    assert (sub.status, sub.plan_code, sub.current_period_end, sub.past_due_at) == before
    assert incidents._webhook_incident(row, now=datetime.now(UTC)).severity == "critical"
    detail = sanitize_webhook_payload(row.payload)
    assert detail["object"]["amount_refunded"] == 1200
    assert detail["object"]["due_by"] == 1900000000
    assert ops_repository.unresolved_risk_count(db) == 1
    db.add(OpsIncidentState(source="stripe_webhook", external_id=row.stripe_event_id,
                            triage_status="acknowledged"))
    db.flush()
    assert ops_repository.unresolved_risk_count(db) == 1
    state = ops_repository.get_incident_state(db, source="stripe_webhook",
                                               external_id=row.stripe_event_id)
    state.triage_status = "resolved"
    db.flush()
    assert ops_repository.unresolved_risk_count(db) == 0


@pytest.mark.parametrize("paginated", [False, True])
@pytest.mark.parametrize(("subs", "expected"), [
    ((), "no_subscription"), (("sub_unmapped",), "unmapped_subscription"),
    (("sub_risk_a", "sub_risk_b"), "multiple_subscriptions"),
])
def test_missing_or_multiple_mapping_never_trusts_metadata(db, stripe, subs, expected, paginated):
    tenant, _ = seed(db)
    stripe.subscriptions = subs
    stripe.paginated = paginated
    payload = event()
    payload["data"]["object"]["metadata"]["tenant_id"] = str(tenant.id)
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.tenant_id is None
    assert row.payload["risk_review"]["mapping"] == expected
    assert incidents._webhook_incident(row, now=datetime.now(UTC)).correlation["tenant_id"] is None


def test_all_invoice_payment_pages_are_resolved_before_assigning_tenant(db, stripe):
    tenant, _ = seed(db)
    stripe.subscriptions = ("sub_risk_a", "sub_risk_a")
    stripe.paginated = True
    payload = event()
    deliver(db, payload)
    assert repository.get_webhook_event(db, stripe_event_id=payload["id"]).tenant_id == tenant.id
    assert ("payments", "inpay_risk_0") in stripe.calls
    assert ("invoices", "in_risk_1") in stripe.calls


def test_failed_lookup_and_repeated_page_leave_global_review(db, stripe, monkeypatch):
    seed(db)
    monkeypatch.setattr(stripe, "invoice_payments", lambda **kw: {
        "data": [{"id": "inpay_repeat", "invoice": "in_risk_0", "status": "paid",
                  "payment": {"type": "payment_intent", "payment_intent": "pi_risk_a"}}],
        "has_more": True,
    })
    payload = event()
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.tenant_id is None and row.payload["risk_review"]["mapping"] == "lookup_limit"
    def unavailable(**kwargs):
        raise StripeRiskError("private provider error NEVER_PERSIST")
    monkeypatch.setattr(stripe, "retrieve", unavailable)
    payload = event()
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.payload["risk_review"]["mapping"] == "lookup_unavailable"
    assert "NEVER_PERSIST" not in json.dumps(row.payload)


def test_forged_signature_or_wrong_mode_never_creates_risk_rows(db, stripe, monkeypatch):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        service.process_stripe_webhook(db, payload=json.dumps(event()).encode(),
                                      signature_header="invalid")
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "stripe_allow_test_mode_in_production", False)
    with pytest.raises(HTTPException):
        deliver(db, event(livemode=False))
    assert db.query(WebhookEvent).count() == 0


def test_legacy_ignored_risk_becomes_visible_and_can_be_reprocessed(db, stripe):
    tenant, _ = seed(db)
    payload = event()
    row = WebhookEvent(stripe_event_id=payload["id"], event_type=payload["type"],
                       processing_status="ignored", tenant_id=tenant.id, payload=payload)
    db.add(row)
    db.flush()
    assert incidents._webhook_incident(row, now=datetime.now(UTC)).correlation["tenant_id"] is None
    assert row in ops_repository.risk_webhooks(db)
    deliver(db, payload)
    db.refresh(row)
    assert row.processing_status == "processed"
    assert row.payload["risk_review"]["mapping"] == "matched"


@pytest.fixture
def committed_tenants(owner_engine):
    with Session(owner_engine) as db:
        a, _ = seed(db)
        b, _ = seed(db, "b")
        tenant_ids = [a.id, b.id]
        db.commit()
    try:
        yield tenant_ids
    finally:
        with Session(owner_engine) as db:
            rows = db.query(WebhookEvent).filter(WebhookEvent.tenant_id.in_(tenant_ids)).all()
            ids = [row.id for row in rows]
            db.query(AuditLog).filter(AuditLog.resource_id.in_(ids)).delete(synchronize_session=False)
            for row in rows:
                db.delete(row)
            db.query(Subscription).filter(Subscription.tenant_id.in_(tenant_ids)).delete()
            db.execute(text("DELETE FROM branches WHERE tenant_id=ANY(:ids)"), {"ids": tenant_ids})
            db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).delete()
            db.commit()


def test_simultaneous_deliveries_share_one_risk_audit(owner_engine, stripe, committed_tenants):
    payload = event()
    barrier = Barrier(2)
    def send():
        with Session(owner_engine) as db:
            barrier.wait(timeout=5)
            return deliver(db, deepcopy(payload))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: send(), range(2)))
    assert results == [{"status": "processed"}] * 2
    with Session(owner_engine) as db:
        row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
        assert row.process_attempts == 1
        assert db.query(AuditLog).filter(AuditLog.resource_id == row.id).count() == 1
    assert stripe.calls.count(("charges", "ch_risk_a")) == 1


def test_runtime_rls_does_not_resolve_other_tenants_or_read_global_risk(
    kova_app_engine, committed_tenants,
):
    with Session(kova_app_engine) as db:
        set_tenant_context(db, committed_tenants[0])
        assert db.execute(text("SELECT current_user")).scalar_one() == "kova_app"
        assert repository.get_subscription_by_stripe_id(db, stripe_subscription_id="sub_risk_b") is None
        assert len(db.query(Subscription).all()) == 1
        with pytest.raises(ProgrammingError):
            db.execute(text("SELECT * FROM webhook_events"))


def test_ops_feed_detail_health_and_existing_triage_for_a_global_risk(db, stripe, monkeypatch):
    monkeypatch.setattr(ops_service, "fetch_all_connectors", lambda: {})
    stripe.subscriptions = ()
    payload = event()
    deliver(db, payload)
    feed = ops_service.build_incidents(db)
    item = next(item for item in feed.items if item.external_id == payload["id"])
    assert item.severity == "critical" and item.correlation.tenant_id is None
    assert item.triage.status == "new"
    assert ops_service.build_revenue(db).webhook_health.status == "ok"
    assert ops_service.build_revenue(db).webhook_health.failed_7d == 0
    assert ops_repository.unresolved_risk_count(db) == 1
    detail = ops_service.build_incident_detail(db, key=item.key)
    assert detail.detail["payload"]["risk_review"]["mapping"] == "no_subscription"
    assert "NEVER_PERSIST" not in detail.model_dump_json()
    ops_repository.upsert_incident_state(db, source="stripe_webhook", external_id=payload["id"],
                                         triage_status="acknowledged", snoozed_until=None, updated_by_user_id=uuid4())
    assert ops_service.build_incidents(db).items[0].triage.status == "acknowledged"
    assert ops_service.build_revenue(db).webhook_health.status == "ok"
    assert ops_service.build_revenue(db).webhook_health.failed_7d == 0
    assert ops_repository.unresolved_risk_count(db) == 1
    ops_repository.upsert_incident_state(db, source="stripe_webhook", external_id=payload["id"],
                                         triage_status="resolved", snoozed_until=None, updated_by_user_id=uuid4())
    assert ops_service.build_revenue(db).webhook_health.status == "ok"


def test_contradictory_customer_cannot_assign_tenant(db, stripe, monkeypatch):
    seed(db)
    original = stripe.retrieve
    def contradict(*, resource, **kwargs):
        result = original(resource=resource, **kwargs)
        if resource == "subscriptions":
            result["customer"] = "cus_somebody_else"
        return result
    monkeypatch.setattr(stripe, "retrieve", contradict)
    payload = event()
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.tenant_id is None
    assert row.payload["risk_review"]["mapping"] == "inconsistent_ownership"


@pytest.mark.parametrize("triage", ["acknowledged", "investigating", "resolved", "ignored"])
def test_separate_risk_health_follows_operator_resolution_not_webhook_delivery(
    db, stripe, monkeypatch, triage,
):
    from datetime import timedelta

    monkeypatch.setattr(ops_service, "fetch_all_connectors", lambda: {
        key: not_configured() for key in ("sentry", "fly", "vercel", "uptimerobot")
    })
    payload = event()
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    state = OpsIncidentState(source="stripe_webhook", external_id=payload["id"],
                             triage_status=triage,
                             snoozed_until=datetime.now(UTC) + timedelta(days=1))
    db.add(state)
    db.flush()
    overview = ops_service.build_overview(db)
    expected = "ok" if triage in {"resolved", "ignored"} else "critical"
    assert overview.health.sources["stripe_risks"].status == expected
    assert overview.health.sources["stripe_webhooks"].status == "ok"
    assert overview.risk.failed_webhooks_24h == 0
    assert ops_service.build_revenue(db).webhook_health.failed_7d == 0
    assert row.processing_status == "processed"


def test_risk_processing_failure_retries_without_persisting_private_payload(db, stripe, monkeypatch):
    original = risk.process
    def fail(*args, **kwargs):
        raise RuntimeError("synthetic processing failure")
    monkeypatch.setattr(risk, "process", fail)
    payload = event()
    db.add(WebhookEvent(stripe_event_id=payload["id"], event_type=payload["type"],
                        processing_status="ignored", payload=payload))
    db.flush()
    with pytest.raises(RuntimeError):
        deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.processing_status == "failed"
    assert row.error_reason == "Risk event processing failed"
    assert "NEVER_PERSIST" not in json.dumps(row.payload)
    monkeypatch.setattr(risk, "process", original)
    deliver(db, payload)
    db.refresh(row)
    assert row.processing_status == "processed"
    assert db.query(AuditLog).filter(AuditLog.resource_id == row.id).count() == 1


def test_mode_mismatch_from_provider_is_global_review(db, stripe, monkeypatch):
    original = stripe.retrieve
    def wrong_mode(**kwargs):
        return original(**kwargs) | {"livemode": True}
    monkeypatch.setattr(stripe, "retrieve", wrong_mode)
    payload = event()
    deliver(db, payload)
    row = repository.get_webhook_event(db, stripe_event_id=payload["id"])
    assert row.tenant_id is None
    assert row.payload["risk_review"]["mapping"] == "inconsistent_ownership"


@pytest.mark.parametrize("object_id", ["du_synthetic", "dp_unsupported", "arbitrary", "du_bad/value"])
def test_dispute_projection_only_retains_documented_dispute_id_prefix(object_id):
    payload = event()
    payload["data"]["object"]["id"] = object_id
    result = risk.project_event(payload)["data"]["object"]
    assert result.get("id") == (object_id if object_id == "du_synthetic" else None)

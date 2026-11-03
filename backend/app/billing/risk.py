"""Durable, read-only risk review. Risk never changes billing or access states."""
import logging
import re
from datetime import UTC, datetime
from time import monotonic
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.billing import repository
from app.billing.models import WebhookEvent
from app.billing.stripe_client import StripeRiskClient, StripeRiskError
from app.config import settings

RISK_EVENTS = frozenset({"charge.refunded", "charge.dispute.created",
                         "radar.early_fraud_warning.created"})
REASONS = frozenset({"matched", "multiple_subscriptions", "no_subscription",
                     "unmapped_subscription",
                     "lookup_unavailable", "inconsistent_ownership", "lookup_limit"})
logger = logging.getLogger(__name__)
client = StripeRiskClient()


def _id(value: Any, prefix: str) -> str | None:
    if isinstance(value, dict):
        value = value.get("id")
    if isinstance(value, str) and re.fullmatch(prefix + r"_[A-Za-z0-9_]{1,200}", value):
        return value
    return None


def project_event(payload: dict) -> dict:
    """Do not persist card, address, email, metadata, evidence or arbitrary external text."""
    data = payload.get("data")
    obj = data.get("object") if isinstance(data, dict) else None
    obj = obj if isinstance(obj, dict) else {}
    event_type = payload["type"]
    clean: dict[str, Any] = {}
    for key, prefix in (("id", "ch" if event_type == "charge.refunded" else
                         "du" if event_type == "charge.dispute.created" else "issfr"),
                        ("charge", "ch"), ("payment_intent", "pi")):
        value = _id(obj.get(key), prefix)
        if value:
            clean[key] = value
    for key in ("amount", "amount_refunded"):
        value = obj.get(key)
        if type(value) is int and value >= 0:
            clean[key] = value
    for key in ("currency", "reason", "status"):
        value = obj.get(key)
        if isinstance(value, str) and re.fullmatch(r"[a-z_]{1,60}", value):
            clean[key] = value
    evidence = obj.get("evidence_details")
    due = evidence.get("due_by") if isinstance(evidence, dict) else obj.get("due_by")
    if type(due) is int and due > 0:
        clean["due_by"] = due
    safe = {key: payload[key] for key in ("id", "type", "created", "livemode") if key in payload}
    return safe | {"data": {"object": clean}}


def safe_review(payload: dict | None) -> dict | None:
    review = (payload or {}).get("risk_review")
    if not isinstance(review, dict) or review.get("mapping") not in REASONS:
        return None
    ids = review.get("subscription_ids")
    if not isinstance(ids, list):
        return None
    return {"mapping": review["mapping"],
            "subscription_ids": [value for value in ids[:20]
                                 if isinstance(value, str) and _id(value, "sub")]}


class _ReviewRequired(Exception):
    pass


def _resolve(db: Session, payload: dict) -> tuple[UUID | None, dict]:
    if type(payload.get("livemode")) is not bool:
        raise _ReviewRequired("inconsistent_ownership")
    secret = settings.stripe_secret_key
    if not secret:
        raise StripeRiskError("Risk lookup unavailable")
    obj = payload["data"]["object"]
    charge_id = obj.get("id") if payload["type"] == "charge.refunded" else obj.get("charge")
    subscriptions: set[str] = set()
    deadline = monotonic() + 15

    def read(resource, object_id):
        if monotonic() > deadline:
            raise _ReviewRequired("lookup_limit")
        value = client.retrieve(secret_key=secret, resource=resource, object_id=object_id)
        if value.get("id") != object_id or value.get("livemode") is not payload.get("livemode"):
            raise _ReviewRequired("inconsistent_ownership")
        return value

    if not charge_id:
        raise _ReviewRequired("inconsistent_ownership")
    charge = read("charges", charge_id)
    intent = _id(charge.get("payment_intent"), "pi")
    customer = _id(charge.get("customer"), "cus")
    if not intent:
        raise _ReviewRequired("no_subscription")
    if not customer or (obj.get("payment_intent") and obj["payment_intent"] != intent):
        raise _ReviewRequired("inconsistent_ownership")
    cursor = None
    invoices: set[str] = set()
    seen_cursors: set[str] = set()
    for _ in range(5):
        if monotonic() > deadline:
            raise _ReviewRequired("lookup_limit")
        page = client.invoice_payments(secret_key=secret, payment_intent=intent,
                                       starting_after=cursor)
        rows = page.get("data")
        if not isinstance(rows, list) or type(page.get("has_more")) is not bool:
            raise _ReviewRequired("inconsistent_ownership")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("payment"), dict):
                raise _ReviewRequired("inconsistent_ownership")
            payment = row["payment"]
            invoice_id = _id(row.get("invoice"), "in")
            if (row.get("status") != "paid" or payment.get("type") != "payment_intent"
                    or _id(payment.get("payment_intent"), "pi") != intent or not invoice_id):
                raise _ReviewRequired("inconsistent_ownership")
            invoices.add(invoice_id)
        if len(invoices) > 20:
            raise _ReviewRequired("lookup_limit")
        if not page["has_more"]:
            break
        cursor = _id(rows[-1].get("id"), "inpay") if rows else None
        if not cursor or cursor in seen_cursors:
            raise _ReviewRequired("lookup_limit")
        seen_cursors.add(cursor)
    else:
        raise _ReviewRequired("lookup_limit")
    for invoice_id in sorted(invoices):
        invoice = read("invoices", invoice_id)
        if _id(invoice.get("customer"), "cus") != customer:
            raise _ReviewRequired("inconsistent_ownership")
        parent = invoice.get("parent") or {}
        if not isinstance(parent, dict):
            raise _ReviewRequired("inconsistent_ownership")
        if parent.get("type") != "subscription_details":
            continue
        details = parent.get("subscription_details")
        if not isinstance(details, dict):
            raise _ReviewRequired("inconsistent_ownership")
        sub_id = _id(details.get("subscription"), "sub")
        if not sub_id:
            raise _ReviewRequired("inconsistent_ownership")
        subscriptions.add(sub_id)
    if not subscriptions:
        raise _ReviewRequired("no_subscription")
    # Even two subscriptions owned by the same business require global review.
    if len(subscriptions) != 1:
        return None, {"mapping": "multiple_subscriptions",
                      "subscription_ids": sorted(subscriptions)}
    sub_id = next(iter(subscriptions))
    remote = read("subscriptions", sub_id)
    if _id(remote.get("customer"), "cus") != customer:
        raise _ReviewRequired("inconsistent_ownership")
    local = repository.get_subscription_by_stripe_id(db, stripe_subscription_id=sub_id)
    if local is None:
        return None, {"mapping": "unmapped_subscription", "subscription_ids": [sub_id]}
    if local.stripe_customer_id != customer:
        raise _ReviewRequired("inconsistent_ownership")
    return local.tenant_id, {"mapping": "matched", "subscription_ids": [sub_id]}


def process(db: Session, event: WebhookEvent, payload: dict) -> dict:
    projected = project_event(payload)
    try:
        tenant, review = _resolve(db, projected)
    except _ReviewRequired as exc:
        tenant, review = None, {"mapping": str(exc), "subscription_ids": []}
    except StripeRiskError:
        tenant, review = None, {"mapping": "lookup_unavailable", "subscription_ids": []}
    event.payload = projected | {"risk_review": review}
    event.tenant_id = tenant
    event.processing_status = "processed"
    event.error_reason = None
    event.process_attempts += 1
    event.processed_at = datetime.now(UTC)
    audit_service.log(db, action="billing.risk_review_required", tenant_id=tenant,
                      resource_type="stripe_risk_event", resource_id=event.id,
                      changes={"event_type": event.event_type, "mapping": review["mapping"]})
    logger.warning("billing.risk_review_required event_type=%s mapping=%s",
                   event.event_type, review["mapping"])
    return {"status": "processed"}

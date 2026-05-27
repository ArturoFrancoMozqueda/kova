import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User
from app.billing import repository
from app.billing.access import get_billing_access_status, serialize_billing_access
from app.billing.models import Subscription, WebhookEvent
from app.billing.stripe_client import (
    StripeCheckoutClient,
    StripeCheckoutError,
    StripePriceClient,
    StripePriceError,
    StripeSubscriptionClient,
    StripeSubscriptionError,
)
from app.config import settings
from app.email import service as email_service
from app.idempotency import service as idempotency_service
from app.shared.exceptions import bad_request

STANDARD_PLAN_NAME = "Standard Plan"
STANDARD_PLAN_AMOUNT_MINOR_UNITS = 29_900
STANDARD_PLAN_CURRENCY = "MXN"
STANDARD_PLAN_INTERVAL = "month"

checkout_client = StripeCheckoutClient()
price_client = StripePriceClient()
subscription_client = StripeSubscriptionClient()
WEBHOOK_TOLERANCE_SECONDS = 300
LIVE_MODE_CONFIGURATION_ERROR = "Stripe checkout is not configured for live mode"


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _checkout_config() -> tuple[str, str, str, str]:
    required = (
        settings.stripe_secret_key,
        settings.stripe_standard_price_id,
        settings.stripe_checkout_success_url,
        settings.stripe_checkout_cancel_url,
    )
    if not all(required):
        raise HTTPException(status_code=503, detail="Stripe checkout is not configured")
    assert settings.stripe_secret_key is not None
    assert settings.stripe_standard_price_id is not None
    assert settings.stripe_checkout_success_url is not None
    assert settings.stripe_checkout_cancel_url is not None
    _validate_live_checkout_configuration(secret_key=settings.stripe_secret_key)
    return (
        settings.stripe_secret_key,
        settings.stripe_standard_price_id,
        settings.stripe_checkout_success_url,
        settings.stripe_checkout_cancel_url,
    )


def _stripe_secret_key() -> str:
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured")
    return settings.stripe_secret_key


def _is_production() -> bool:
    return settings.app_env == "production"


def _requires_live_stripe() -> bool:
    return _is_production() and not settings.stripe_allow_test_mode_in_production


def _validate_live_checkout_configuration(*, secret_key: str) -> None:
    if _requires_live_stripe() and secret_key.startswith(("sk_test_", "rk_test_")):
        raise HTTPException(status_code=503, detail=LIVE_MODE_CONFIGURATION_ERROR)


def _validate_live_checkout_session(stripe_session: dict[str, Any]) -> None:
    if not _requires_live_stripe():
        return
    checkout_session_id = str(stripe_session.get("id") or "")
    checkout_url = str(stripe_session.get("url") or "")
    if (
        checkout_session_id.startswith("cs_test")
        or "cs_test" in checkout_url
        or "checkout.stripe.test" in checkout_url
    ):
        raise HTTPException(status_code=503, detail=LIVE_MODE_CONFIGURATION_ERROR)


def _validate_standard_price_configuration(*, secret_key: str, price_id: str) -> None:
    try:
        price = price_client.retrieve_price(secret_key=secret_key, price_id=price_id)
    except StripePriceError as exc:
        raise HTTPException(status_code=502, detail="Stripe price validation failed") from exc

    recurring = price.get("recurring") or {}
    currency = str(price.get("currency") or "").upper()
    if (
        price.get("active") is not True
        or price.get("unit_amount") != STANDARD_PLAN_AMOUNT_MINOR_UNITS
        or currency != STANDARD_PLAN_CURRENCY
        or recurring.get("interval") != STANDARD_PLAN_INTERVAL
    ):
        raise HTTPException(
            status_code=503,
            detail="Stripe Standard Plan price is misconfigured",
        )


def _webhook_secret() -> str:
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook is not configured")
    return settings.stripe_webhook_secret


def _parse_signature_header(signature_header: str) -> tuple[int, list[str]]:
    timestamp: int | None = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        key, _, value = part.partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError as exc:
                raise bad_request("Invalid Stripe signature") from exc
        elif key == "v1":
            signatures.append(value)
    if timestamp is None or not signatures:
        raise bad_request("Invalid Stripe signature")
    return timestamp, signatures


def verify_stripe_signature(
    *, payload: bytes, signature_header: str | None, secret: str | None = None
) -> None:
    if not signature_header:
        raise bad_request("Missing Stripe signature")
    secret = secret or _webhook_secret()
    timestamp, signatures = _parse_signature_header(signature_header)
    if abs(time.time() - timestamp) > WEBHOOK_TOLERANCE_SECONDS:
        raise bad_request("Invalid Stripe signature")
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, signature) for signature in signatures):
        raise bad_request("Invalid Stripe signature")


def get_subscription_status(db: Session, *, tenant_id: UUID) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    access = get_billing_access_status(db, tenant_id=tenant_id)
    return {
        "plan": {
            "name": STANDARD_PLAN_NAME,
            "amount_minor_units": STANDARD_PLAN_AMOUNT_MINOR_UNITS,
            "currency": STANDARD_PLAN_CURRENCY,
            "interval": STANDARD_PLAN_INTERVAL,
        },
        "subscription": subscription,
        "access": serialize_billing_access(access),
    }


def create_checkout_session(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    if subscription and subscription.status in {"active", "trialing"}:
        raise bad_request("Tenant already has an active subscription")

    secret_key, price_id, success_url, cancel_url = _checkout_config()
    payload = {
        "tenant_id": str(tenant_id),
        "user_id": str(user_id),
        "price_id": price_id,
    }
    request_hash = _hash_payload(payload)
    existing = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if existing:
        if existing.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body")
        return existing.response_status or 200, existing.response_body or {}

    _validate_standard_price_configuration(secret_key=secret_key, price_id=price_id)

    try:
        stripe_session = checkout_client.create_checkout_session(
            secret_key=secret_key,
            price_id=price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            tenant_id=str(tenant_id),
            user_id=str(user_id),
            idempotency_key=f"checkout:{tenant_id}:{idempotency_key}",
        )
    except StripeCheckoutError as exc:
        raise HTTPException(status_code=502, detail="Stripe checkout failed") from exc

    _validate_live_checkout_session(stripe_session)
    checkout_url = stripe_session.get("url")
    checkout_session_id = stripe_session.get("id")
    if not checkout_url or not checkout_session_id:
        raise HTTPException(status_code=502, detail="Stripe checkout response was incomplete")

    response_body = {
        "checkout_url": checkout_url,
        "checkout_session_id": checkout_session_id,
    }
    audit_service.log(
        db,
        action="billing.checkout_started",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="checkout_session",
        changes={
            "checkout_session_id": checkout_session_id,
            "price_id": price_id,
            "plan_name": STANDARD_PLAN_NAME,
        },
    )
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=request_hash,
        response_status=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def cancel_subscription(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    if not subscription:
        return get_subscription_status(db, tenant_id=tenant_id)
    if subscription.cancel_at_period_end or subscription.status == "canceled":
        return get_subscription_status(db, tenant_id=tenant_id)
    if not subscription.stripe_subscription_id:
        raise bad_request("Subscription is missing Stripe subscription id")

    secret_key = _stripe_secret_key()
    try:
        stripe_subscription = subscription_client.update_cancel_at_period_end(
            secret_key=secret_key,
            stripe_subscription_id=subscription.stripe_subscription_id,
            idempotency_key=f"cancel:{tenant_id}:{subscription.stripe_subscription_id}",
        )
    except StripeSubscriptionError as exc:
        raise HTTPException(status_code=502, detail="Stripe cancellation failed") from exc

    subscription.cancel_at_period_end = bool(
        stripe_subscription.get("cancel_at_period_end", True)
    )
    subscription.status = _subscription_status(stripe_subscription.get("status"))
    cancel_start, cancel_end = _extract_period(stripe_subscription)
    subscription.current_period_start = _timestamp(cancel_start)
    subscription.current_period_end = _timestamp(cancel_end)
    subscription.canceled_at = _timestamp(stripe_subscription.get("canceled_at"))
    audit_service.log(
        db,
        action="billing.subscription_cancel_requested",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="subscription",
        resource_id=subscription.id,
        changes={
            "stripe_subscription_id": subscription.stripe_subscription_id,
            "cancel_at_period_end": subscription.cancel_at_period_end,
        },
    )
    db.commit()
    return get_subscription_status(db, tenant_id=tenant_id)


def _timestamp(value: Any) -> Any:
    if value is None:
        return None

    return datetime.fromtimestamp(int(value), tz=UTC)


def _extract_period(stripe_object: dict[str, Any]) -> tuple[Any, Any]:
    start = stripe_object.get("current_period_start")
    end = stripe_object.get("current_period_end")
    if start is None or end is None:
        items = stripe_object.get("items", {}).get("data", [])
        if items:
            first = items[0]
            if start is None:
                start = first.get("current_period_start")
            if end is None:
                end = first.get("current_period_end")
    return start, end


def _subscription_status(stripe_status: str | None) -> str:
    if stripe_status in {"trialing", "active", "past_due", "canceled", "unpaid"}:
        return stripe_status
    return "incomplete"


def _mark_subscription_past_due(subscription: Subscription) -> None:
    now = datetime.now(UTC)
    subscription.status = "past_due"
    subscription.past_due_at = subscription.past_due_at or now
    subscription.grace_period_ends_at = subscription.grace_period_ends_at or (
        now + timedelta(days=settings.billing_grace_period_days)
    )


def _clear_subscription_past_due(subscription: Subscription) -> None:
    subscription.past_due_at = None
    subscription.grace_period_ends_at = None


def _upsert_subscription_from_stripe_object(
    db: Session,
    *,
    tenant_id: UUID,
    stripe_object: dict[str, Any],
) -> Subscription:
    stripe_subscription_id = stripe_object.get("subscription") or stripe_object.get("id")
    if not stripe_subscription_id:
        raise ValueError("Missing Stripe subscription id")
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    if not subscription:
        subscription = Subscription(tenant_id=tenant_id)
        db.add(subscription)

    subscription.stripe_customer_id = stripe_object.get("customer")
    subscription.stripe_subscription_id = stripe_subscription_id
    subscription.latest_checkout_session_id = (
        stripe_object.get("id")
        if stripe_object.get("object") == "checkout.session"
        else subscription.latest_checkout_session_id
    )
    if stripe_object.get("object") == "checkout.session":
        subscription.status = "active"
    else:
        subscription.status = _subscription_status(stripe_object.get("status"))
    period_start, period_end = _extract_period(stripe_object)
    subscription.current_period_start = _timestamp(period_start)
    subscription.current_period_end = _timestamp(period_end)
    subscription.trial_ends_at = _timestamp(stripe_object.get("trial_end"))
    subscription.cancel_at_period_end = bool(stripe_object.get("cancel_at_period_end", False))
    subscription.canceled_at = _timestamp(stripe_object.get("canceled_at"))
    if subscription.status == "past_due":
        _mark_subscription_past_due(subscription)
    if subscription.status in {"active", "trialing"}:
        _clear_subscription_past_due(subscription)
    items = stripe_object.get("items", {}).get("data", [])
    if items:
        price = items[0].get("price", {})
        subscription.stripe_price_id = price.get("id")
        if price.get("unit_amount") is not None:
            subscription.amount_minor_units = int(price["unit_amount"])
        if price.get("currency"):
            subscription.currency = str(price["currency"]).upper()
    db.flush()
    return subscription


def _owner_email_for_tenant(db: Session, *, tenant_id: UUID) -> str | None:
    owner = (
        db.query(User)
        .join(Membership, Membership.user_id == User.id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
        .order_by(Membership.created_at.asc())
        .first()
    )
    return owner.email if owner else None


def _send_welcome_email_for_tenant(db: Session, *, tenant_id: UUID) -> None:
    email = _owner_email_for_tenant(db, tenant_id=tenant_id)
    if not email:
        return
    email_service.send_welcome_email(to=email)


def _send_payment_receipt_for_tenant(
    db: Session,
    *,
    tenant_id: UUID,
    invoice_object: dict[str, Any],
) -> None:
    email = _owner_email_for_tenant(db, tenant_id=tenant_id)
    if not email:
        return
    amount_minor = invoice_object.get("amount_paid")
    if amount_minor is None:
        amount_minor = invoice_object.get("amount_due") or 0
    currency = str(invoice_object.get("currency") or STANDARD_PLAN_CURRENCY).upper()
    invoice_number = invoice_object.get("number") or invoice_object.get("id")
    invoice_url = (
        invoice_object.get("hosted_invoice_url")
        or invoice_object.get("invoice_pdf")
    )
    period_end_ts = invoice_object.get("period_end")
    if not period_end_ts:
        lines_data = (invoice_object.get("lines") or {}).get("data") or []
        if lines_data:
            period_end_ts = (lines_data[0].get("period") or {}).get("end")
    period_end_iso: str | None = None
    if period_end_ts:
        try:
            period_end_iso = datetime.fromtimestamp(int(period_end_ts), tz=UTC).strftime(
                "%Y-%m-%d"
            )
        except (TypeError, ValueError):
            period_end_iso = None
    email_service.send_payment_receipt_email(
        to=email,
        amount_minor_units=int(amount_minor),
        currency=currency,
        invoice_number=str(invoice_number) if invoice_number else None,
        invoice_url=str(invoice_url) if invoice_url else None,
        period_end_iso=period_end_iso,
    )


def _tenant_id_from_event_object(stripe_object: dict[str, Any]) -> UUID | None:
    metadata = stripe_object.get("metadata") or {}
    tenant_id = metadata.get("tenant_id")
    if not tenant_id:
        return None
    try:
        return UUID(str(tenant_id))
    except ValueError:
        return None


def _mark_event(
    event: WebhookEvent,
    *,
    status: str,
    tenant_id: UUID | None = None,
    error_reason: str | None = None,
) -> None:
    from datetime import UTC, datetime

    event.processing_status = status
    event.tenant_id = tenant_id
    event.error_reason = error_reason
    event.process_attempts += 1
    event.processed_at = datetime.now(UTC)


def process_stripe_webhook(db: Session, *, payload: bytes, signature_header: str | None) -> dict:
    verify_stripe_signature(payload=payload, signature_header=signature_header)
    try:
        event_payload = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise bad_request("Invalid Stripe webhook payload") from exc

    stripe_event_id = event_payload.get("id")
    event_type = event_payload.get("type")
    if not stripe_event_id or not event_type:
        raise bad_request("Invalid Stripe webhook payload")

    existing = repository.get_webhook_event(db, stripe_event_id=stripe_event_id)
    if existing and existing.processing_status in {"processed", "ignored"}:
        return {"status": existing.processing_status}

    event = existing or WebhookEvent(
        stripe_event_id=stripe_event_id,
        event_type=event_type,
        payload=event_payload,
    )
    if not existing:
        db.add(event)
        db.flush()

    stripe_object = event_payload.get("data", {}).get("object", {})
    tenant_id = _tenant_id_from_event_object(stripe_object)
    if tenant_id is None and stripe_object.get("subscription"):
        subscription = repository.get_subscription_by_stripe_id(
            db, stripe_subscription_id=str(stripe_object["subscription"])
        )
        tenant_id = subscription.tenant_id if subscription else None

    try:
        if event_type in {
            "checkout.session.completed",
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            if tenant_id is None:
                _mark_event(event, status="ignored", error_reason="Missing tenant metadata")
                db.commit()
                return {"status": "ignored"}
            subscription = _upsert_subscription_from_stripe_object(
                db, tenant_id=tenant_id, stripe_object=stripe_object
            )
            if event_type == "checkout.session.completed":
                action = "billing.subscription_activated"
                _send_welcome_email_for_tenant(db, tenant_id=tenant_id)
            elif event_type == "customer.subscription.deleted":
                action = "billing.subscription_canceled"
            else:
                action = "billing.subscription_status_updated"
            audit_service.log(
                db,
                action=action,
                tenant_id=tenant_id,
                resource_type="subscription",
                resource_id=subscription.id,
                changes={"status": subscription.status, "stripe_event_id": stripe_event_id},
            )
            _mark_event(event, status="processed", tenant_id=tenant_id)
        elif event_type in {"invoice.payment_succeeded", "invoice.payment_failed"}:
            if tenant_id is None:
                _mark_event(event, status="ignored", error_reason="Missing subscription mapping")
                db.commit()
                return {"status": "ignored"}
            subscription = None
            if stripe_object.get("subscription"):
                subscription = repository.get_subscription_by_stripe_id(
                    db, stripe_subscription_id=str(stripe_object["subscription"])
                )
            if subscription and event_type == "invoice.payment_failed":
                _mark_subscription_past_due(subscription)
            elif subscription and event_type == "invoice.payment_succeeded":
                subscription.status = "active"
                _clear_subscription_past_due(subscription)
            if event_type == "invoice.payment_succeeded":
                _send_payment_receipt_for_tenant(
                    db, tenant_id=tenant_id, invoice_object=stripe_object
                )
            action = (
                "billing.payment_failed"
                if event_type == "invoice.payment_failed"
                else "billing.payment_succeeded"
            )
            audit_service.log(
                db,
                action=action,
                tenant_id=tenant_id,
                resource_type="subscription",
                resource_id=subscription.id if subscription else None,
                changes={"stripe_event_id": stripe_event_id},
            )
            _mark_event(event, status="processed", tenant_id=tenant_id)
        else:
            _mark_event(event, status="ignored", tenant_id=tenant_id)
        db.commit()
        return {"status": event.processing_status}
    except Exception as exc:
        _mark_event(event, status="failed", tenant_id=tenant_id, error_reason=str(exc))
        db.commit()
        raise

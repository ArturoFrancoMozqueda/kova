import hashlib
import hmac
import json
import logging
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
from app.billing.schemas import BILLING_PERIOD_FRESHNESS_MAX_AGE
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
from app.shared.exceptions import bad_request, forbidden

logger = logging.getLogger(__name__)

# A tenant in any of these statuses already has a live Stripe subscription that
# may still bill them, so a new checkout would mint a duplicate customer +
# subscription (double billing). `canceled`/`incomplete` are intentionally
# excluded so a churned or never-completed tenant can re-subscribe (reusing the
# stored Stripe customer).
LIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "past_due", "unpaid"}
STANDARD_PLAN_NAME = "Standard Plan"
STANDARD_PLAN_AMOUNT_MINOR_UNITS = 29_900
STANDARD_PLAN_CURRENCY = "MXN"
STANDARD_PLAN_INTERVAL = "month"
BILLING_PERIOD_RESYNC_TTL = BILLING_PERIOD_FRESHNESS_MAX_AGE

# Stripe does not guarantee webhook delivery order. Watermarks are separated
# because subscription lifecycle and invoice payment events are independent
# streams. For equal timestamps, terminal/success states win conservatively;
# two different events of the same rank are ambiguous and trigger a bounded
# authoritative lookup instead of relying on arrival order or event-id sorting.
EVENT_FAMILY_LIFECYCLE = "lifecycle"
EVENT_FAMILY_PAYMENT = "payment"
EVENT_PRECEDENCE = {
    "checkout.session.completed": 10,
    "customer.subscription.created": 20,
    "customer.subscription.updated": 30,
    "customer.subscription.deleted": 40,
    "invoice.payment_failed": 10,
    "invoice.payment_succeeded": 20,
    "invoice.paid": 20,
}

checkout_client = StripeCheckoutClient()
price_client = StripePriceClient()
subscription_client = StripeSubscriptionClient()
WEBHOOK_TOLERANCE_SECONDS = 300
LIVE_MODE_CONFIGURATION_ERROR = "Stripe checkout is not configured for live mode"


def _now_utc() -> datetime:
    return datetime.now(UTC)


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


def _is_test_mode_webhook_secret(value: str | None) -> bool:
    return bool(value and value.startswith("whsec_test"))


def validate_webhook_secret_mode() -> None:
    """Boot guard: a live deployment must not verify webhooks with a test-mode
    signing secret.

    Without this, Stripe *test*-mode events would pass signature verification in
    production and mutate real subscription state. Mirrors the live/test guard
    already applied to the Stripe secret key. Skipped when test mode is
    explicitly allowed in production (``stripe_allow_test_mode_in_production``).
    """
    if _requires_live_stripe() and _is_test_mode_webhook_secret(
        settings.stripe_webhook_secret
    ):
        raise RuntimeError("STRIPE_WEBHOOK_SECRET must use live mode in production")


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


def _maybe_resync_period(db: Session, subscription: Subscription) -> None:
    """Best-effort refresh of the renewal date from the live subscription.

    Self-heals rows whose period has never been confirmed from Stripe, is
    missing, is stale, or has passed the backend TTL. Never raises: a read of
    the billing page must not depend on a live Stripe call succeeding.
    """
    if subscription.status not in {"active", "trialing"}:
        return
    if not subscription.stripe_subscription_id or not settings.stripe_secret_key:
        return
    now = _now_utc()
    current_end = subscription.current_period_end
    current_end_utc = current_end if current_end and current_end.tzinfo else (
        current_end.replace(tzinfo=UTC) if current_end else None
    )
    synced_at = subscription.stripe_period_synced_at
    synced_at_utc = synced_at if synced_at and synced_at.tzinfo else (
        synced_at.replace(tzinfo=UTC) if synced_at else None
    )
    needs_resync = (
        current_end_utc is None
        or current_end_utc <= now
        or synced_at_utc is None
        or synced_at_utc <= now - BILLING_PERIOD_RESYNC_TTL
    )
    if not needs_resync:
        return
    period_start, period_end = _retrieve_live_period(subscription.stripe_subscription_id)
    if period_end is None:
        return
    next_period_end = _timestamp(period_end)
    next_period_start = _timestamp(period_start) if period_start is not None else None
    if subscription.current_period_end == next_period_end and (
        next_period_start is None or subscription.current_period_start == next_period_start
    ):
        subscription.stripe_period_synced_at = now
        db.commit()
        return
    subscription.current_period_end = next_period_end
    if period_start is not None:
        subscription.current_period_start = next_period_start
    subscription.stripe_period_synced_at = now
    db.commit()


def get_subscription_status(db: Session, *, tenant_id: UUID, resync: bool = False) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    if resync and subscription is not None:
        _maybe_resync_period(db, subscription)
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
    if subscription and subscription.status in LIVE_SUBSCRIPTION_STATUSES:
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
            # Reuse the tenant's Stripe customer on re-subscription so we never
            # create a second customer that could keep billing in parallel.
            customer=subscription.stripe_customer_id if subscription else None,
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


def reconcile_checkout_session(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    session_id: str,
) -> dict:
    """Self-heal a lost ``checkout.session.completed`` webhook.

    Fetches the checkout session from Stripe, verifies it belongs to the
    calling tenant, and — if it is paid — runs the same activation path as the
    webhook, idempotently. Safe to call repeatedly: a second call after the
    subscription is already active is a no-op (no duplicate audit/email).
    """
    secret_key = _stripe_secret_key()
    try:
        stripe_session = checkout_client.retrieve_session(
            secret_key=secret_key, session_id=session_id
        )
    except StripeCheckoutError as exc:
        raise HTTPException(status_code=502, detail="Stripe session lookup failed") from exc

    # Tenant isolation: only ever act on a session this tenant owns.
    session_tenant_id = _tenant_id_from_event_object(stripe_session)
    if session_tenant_id is None or session_tenant_id != tenant_id:
        raise forbidden("Checkout session does not belong to this tenant")

    paid = (
        stripe_session.get("payment_status") == "paid"
        or stripe_session.get("status") == "complete"
    )
    if not paid:
        return get_subscription_status(db, tenant_id=tenant_id)

    existing = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    already_active = bool(
        existing
        and existing.status == "active"
        and existing.latest_checkout_session_id == stripe_session.get("id")
    )
    # The retrieved object is a checkout.session, so the upsert treats it as an
    # activation (status -> active, records latest_checkout_session_id).
    stripe_session["object"] = "checkout.session"
    subscription = _upsert_subscription_from_stripe_object(
        db, tenant_id=tenant_id, stripe_object=stripe_session
    )
    _set_watermark(
        subscription,
        family=EVENT_FAMILY_LIFECYCLE,
        created_at=_now_utc(),
        event_id=f"checkout-reconcile:{session_id}",
        event_type="checkout.session.completed",
    )
    if not already_active:
        audit_service.log(
            db,
            action="billing.subscription_activated",
            tenant_id=tenant_id,
            user_id=user_id,
            resource_type="subscription",
            resource_id=subscription.id,
            changes={
                "status": subscription.status,
                "checkout_session_id": stripe_session.get("id"),
                "source": "reconcile",
            },
        )
        _send_welcome_email_for_tenant(db, tenant_id=tenant_id)
    db.commit()
    return get_subscription_status(db, tenant_id=tenant_id)


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
    if cancel_end is not None:
        subscription.stripe_period_synced_at = _now_utc()
    subscription.canceled_at = _timestamp(stripe_subscription.get("canceled_at"))
    _set_watermark(
        subscription,
        family=EVENT_FAMILY_LIFECYCLE,
        created_at=_now_utc(),
        event_id=f"cancel-api:{subscription.stripe_subscription_id}",
        event_type="customer.subscription.updated",
    )
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


def _retrieve_live_period(stripe_subscription_id: str | None) -> tuple[Any, Any]:
    """Pull the authoritative billing period from the live Stripe subscription.

    Some payloads (notably ``checkout.session`` and, on recent API versions,
    invoices) don't carry ``current_period_*``. The subscription object is the
    single source of truth, so we fetch it directly. Returns ``(None, None)``
    when we lack the id/secret or the fetch fails, so callers can degrade
    gracefully without clobbering a known period.
    """
    if not stripe_subscription_id or not settings.stripe_secret_key:
        return None, None
    try:
        live_subscription = subscription_client.retrieve(
            secret_key=settings.stripe_secret_key,
            stripe_subscription_id=str(stripe_subscription_id),
        )
    except StripeSubscriptionError:
        return None, None
    return _extract_period(live_subscription)


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
    subscription = repository.lock_subscription_by_tenant(db, tenant_id=tenant_id)
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
    if period_start is None or period_end is None:
        # The object lacks the period (e.g. checkout.session, or invoices on
        # API 2026-04-22.dahlia). Fetch the live subscription so we store the
        # real renewal date instead of leaving/overwriting it with None.
        live_start, live_end = _retrieve_live_period(stripe_subscription_id)
        period_start = period_start if period_start is not None else live_start
        period_end = period_end if period_end is not None else live_end
    # Never clobber a known period with None: keep the last good value when a
    # period-less event arrives out of order.
    if period_start is not None:
        subscription.current_period_start = _timestamp(period_start)
    if period_end is not None:
        subscription.current_period_end = _timestamp(period_end)
        subscription.stripe_period_synced_at = _now_utc()
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


def _tenant_id_from_related_subscription(
    db: Session, *, event_type: str, stripe_object: dict[str, Any]
) -> UUID | None:
    """Resolve the tenant from the local subscription row when metadata is absent.

    Production ``customer.subscription.*`` events carry the subscription id in
    ``id`` (not ``subscription``), so map via that id. Invoice events keep the
    existing ``subscription`` / ``parent.subscription_details.subscription``
    resolution. Returns None when no local subscription matches.
    """
    if event_type.startswith("customer.subscription."):
        related_subscription_id = stripe_object.get("id")
    else:
        related_subscription_id = stripe_object.get("subscription") or (
            (stripe_object.get("parent") or {})
            .get("subscription_details", {})
            .get("subscription")
        )
    if not related_subscription_id:
        return None
    subscription = repository.get_subscription_by_stripe_id(
        db, stripe_subscription_id=str(related_subscription_id)
    )
    return subscription.tenant_id if subscription else None


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


def _event_created_at(event_payload: dict[str, Any]) -> datetime | None:
    value = event_payload.get("created")
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=UTC)
    except (TypeError, ValueError, OSError):
        return None


def _event_family(event_type: str) -> str | None:
    if event_type in {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        return EVENT_FAMILY_LIFECYCLE
    if event_type in {"invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed"}:
        return EVENT_FAMILY_PAYMENT
    return None


def _watermark(
    subscription: Subscription, *, family: str
) -> tuple[datetime | None, str | None, str | None]:
    if family == EVENT_FAMILY_LIFECYCLE:
        return (
            subscription.stripe_lifecycle_watermark_at,
            subscription.stripe_lifecycle_event_id,
            subscription.stripe_lifecycle_event_type,
        )
    return (
        subscription.stripe_payment_watermark_at,
        subscription.stripe_payment_event_id,
        subscription.stripe_payment_event_type,
    )


def _set_watermark(
    subscription: Subscription,
    *,
    family: str,
    created_at: datetime | None,
    event_id: str,
    event_type: str,
) -> None:
    if created_at is None:
        return
    if family == EVENT_FAMILY_LIFECYCLE:
        subscription.stripe_lifecycle_watermark_at = created_at
        subscription.stripe_lifecycle_event_id = event_id
        subscription.stripe_lifecycle_event_type = event_type
    else:
        subscription.stripe_payment_watermark_at = created_at
        subscription.stripe_payment_event_id = event_id
        subscription.stripe_payment_event_type = event_type


def _temporal_decision(
    subscription: Subscription,
    *,
    family: str,
    event_created_at: datetime | None,
    event_id: str,
    event_type: str,
) -> str:
    watermark_at, watermark_id, watermark_type = _watermark(subscription, family=family)
    if watermark_at is None:
        return "accept"
    if event_created_at is None:
        return "reconcile"
    watermark_at = watermark_at if watermark_at.tzinfo else watermark_at.replace(tzinfo=UTC)
    if event_created_at > watermark_at:
        return "accept"
    if event_created_at < watermark_at:
        return "stale"
    if event_id == watermark_id:
        return "stale"
    incoming_rank = EVENT_PRECEDENCE[event_type]
    stored_rank = EVENT_PRECEDENCE.get(watermark_type or "", -1)
    if incoming_rank > stored_rank:
        return "accept"
    if incoming_rank < stored_rank:
        return "stale"
    return "reconcile"


def _stripe_subscription_id(*, event_type: str, stripe_object: dict[str, Any]) -> str | None:
    if event_type.startswith("customer.subscription."):
        value = stripe_object.get("id")
    else:
        value = stripe_object.get("subscription") or (
            (stripe_object.get("parent") or {})
            .get("subscription_details", {})
            .get("subscription")
        )
    return str(value) if value else None


def _retrieve_authoritative_subscription(stripe_subscription_id: str) -> dict[str, Any]:
    if not settings.stripe_secret_key:
        raise StripeSubscriptionError("Stripe billing is not configured")
    return subscription_client.retrieve(
        secret_key=settings.stripe_secret_key,
        stripe_subscription_id=stripe_subscription_id,
    )


def _reconcile_ambiguous_event(
    db: Session,
    *,
    tenant_id: UUID,
    subscription: Subscription,
    family: str,
    event_id: str,
    event_type: str,
    event_created_at: datetime | None,
    stripe_object: dict[str, Any],
) -> Subscription:
    subscription_id = _stripe_subscription_id(
        event_type=event_type, stripe_object=stripe_object
    ) or subscription.stripe_subscription_id
    if not subscription_id:
        raise StripeSubscriptionError("Missing Stripe subscription id for reconciliation")
    live_subscription = _retrieve_authoritative_subscription(subscription_id)
    previous_status = subscription.status
    subscription = _upsert_subscription_from_stripe_object(
        db, tenant_id=tenant_id, stripe_object=live_subscription
    )
    reconciled_at = _now_utc()
    if event_created_at is not None and event_created_at > reconciled_at:
        reconciled_at = event_created_at
    _set_watermark(
        subscription,
        family=family,
        created_at=reconciled_at,
        event_id=f"authoritative:{event_id}",
        event_type=event_type,
    )
    logger.warning(
        "billing.webhook.divergence_reconciled event_type=%s stripe_event_id=%s "
        "previous_status=%s authoritative_status=%s",
        event_type,
        event_id,
        previous_status,
        subscription.status,
    )
    return subscription


def _ignore_stale_event(
    event: WebhookEvent,
    *,
    tenant_id: UUID,
    family: str,
    event_created_at: datetime | None,
) -> dict[str, str]:
    reason = f"stale_{family}_event"
    logger.info(
        "billing.webhook.stale_ignored event_type=%s stripe_event_id=%s event_created=%s",
        event.event_type,
        event.stripe_event_id,
        event_created_at.isoformat() if event_created_at else None,
    )
    _mark_event(event, status="ignored", tenant_id=tenant_id, error_reason=reason)
    return {"status": "ignored"}


def _process_temporal_event(
    db: Session,
    *,
    event: WebhookEvent,
    event_payload: dict[str, Any],
    stripe_object: dict[str, Any],
    tenant_id: UUID,
) -> dict[str, str]:
    event_type = event.event_type
    event_id = event.stripe_event_id
    family = _event_family(event_type)
    assert family is not None

    repository.lock_billing_tenant(db, tenant_id=tenant_id)
    subscription = repository.lock_subscription_by_tenant(db, tenant_id=tenant_id)
    if subscription is None and family == EVENT_FAMILY_PAYMENT:
        if event_type in {"invoice.paid", "invoice.payment_succeeded"}:
            _send_payment_receipt_for_tenant(
                db, tenant_id=tenant_id, invoice_object=stripe_object
            )
            audit_service.log(
                db,
                action="billing.payment_succeeded",
                tenant_id=tenant_id,
                resource_type="subscription",
                changes={"stripe_event_id": event_id},
            )
            _mark_event(event, status="processed", tenant_id=tenant_id)
            return {"status": "processed"}
        _mark_event(
            event,
            status="ignored",
            tenant_id=tenant_id,
            error_reason="Missing subscription mapping",
        )
        return {"status": "ignored"}

    event_created_at = _event_created_at(event_payload)
    decision = (
        _temporal_decision(
            subscription,
            family=family,
            event_created_at=event_created_at,
            event_id=event_id,
            event_type=event_type,
        )
        if subscription is not None
        else "accept"
    )
    if decision == "stale":
        return _ignore_stale_event(
            event,
            tenant_id=tenant_id,
            family=family,
            event_created_at=event_created_at,
        )

    reconciled = decision == "reconcile"
    if reconciled:
        assert subscription is not None
        subscription = _reconcile_ambiguous_event(
            db,
            tenant_id=tenant_id,
            subscription=subscription,
            family=family,
            event_id=event_id,
            event_type=event_type,
            event_created_at=event_created_at,
            stripe_object=stripe_object,
        )
    elif family == EVENT_FAMILY_LIFECYCLE:
        object_to_apply = dict(stripe_object)
        if event_type == "customer.subscription.deleted":
            object_to_apply["status"] = "canceled"
        subscription = _upsert_subscription_from_stripe_object(
            db, tenant_id=tenant_id, stripe_object=object_to_apply
        )
        _set_watermark(
            subscription,
            family=family,
            created_at=event_created_at,
            event_id=event_id,
            event_type=event_type,
        )

    assert subscription is not None
    if family == EVENT_FAMILY_LIFECYCLE:
        if event_type == "checkout.session.completed":
            action = "billing.subscription_activated"
            if not reconciled and subscription.status == "active":
                _send_welcome_email_for_tenant(db, tenant_id=tenant_id)
        elif event_type == "customer.subscription.deleted":
            action = "billing.subscription_canceled"
        else:
            action = "billing.subscription_status_updated"
    else:
        payment_succeeded = event_type in {"invoice.paid", "invoice.payment_succeeded"}
        if not reconciled and event_type == "invoice.payment_failed":
            _mark_subscription_past_due(subscription)
        elif not reconciled and payment_succeeded:
            subscription.status = "active"
            _clear_subscription_past_due(subscription)
            period_start, period_end = _retrieve_live_period(
                subscription.stripe_subscription_id
            )
            if period_start is not None:
                subscription.current_period_start = _timestamp(period_start)
            if period_end is not None:
                subscription.current_period_end = _timestamp(period_end)
                subscription.stripe_period_synced_at = _now_utc()
        if not reconciled:
            _set_watermark(
                subscription,
                family=family,
                created_at=event_created_at,
                event_id=event_id,
                event_type=event_type,
            )
        if payment_succeeded and not reconciled:
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
        resource_id=subscription.id,
        changes={"status": subscription.status, "stripe_event_id": event_id},
    )
    _mark_event(event, status="processed", tenant_id=tenant_id)
    return {"status": "processed"}


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

    event, _ = repository.claim_webhook_event(
        db,
        stripe_event_id=stripe_event_id,
        event_type=event_type,
        payload=event_payload,
    )
    if event.processing_status in {"processed", "ignored"}:
        return {"status": event.processing_status}

    stripe_object = event_payload.get("data", {}).get("object", {})
    tenant_id = _tenant_id_from_event_object(stripe_object)
    if tenant_id is None:
        # Production subscription-lifecycle events (customer.subscription.*)
        # carry no session metadata, and API 2026-04-22.dahlia moved the
        # invoice's subscription id into `parent.subscription_details`. Resolve
        # the tenant from the local subscription row keyed by the Stripe
        # subscription id so cancellations/updates still converge status.
        tenant_id = _tenant_id_from_related_subscription(
            db, event_type=event_type, stripe_object=stripe_object
        )

    try:
        family = _event_family(event_type)
        if family is not None and tenant_id is not None:
            result = _process_temporal_event(
                db,
                event=event,
                event_payload=event_payload,
                stripe_object=stripe_object,
                tenant_id=tenant_id,
            )
            db.commit()
            return result
        if family is not None:
            reason = (
                "Missing subscription mapping"
                if family == EVENT_FAMILY_PAYMENT
                else "Missing tenant metadata"
            )
            logger.warning(
                "billing.webhook.ignored_unknown_tenant "
                "event_type=%s stripe_event_id=%s reason=%s",
                event_type,
                stripe_event_id,
                reason,
            )
            _mark_event(event, status="ignored", error_reason=reason)
        else:
            _mark_event(event, status="ignored", tenant_id=tenant_id)
        db.commit()
        return {"status": event.processing_status}
    except Exception as exc:
        _mark_event(event, status="failed", tenant_id=tenant_id, error_reason=str(exc))
        db.commit()
        raise


def reconcile_subscriptions(db: Session, *, limit: int = 100) -> dict[str, int]:
    """Bounded repair job that converges local subscription state to Stripe."""
    subscriptions = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id.is_not(None))
        .order_by(Subscription.updated_at.asc())
        .limit(limit)
        .all()
    )
    checked = updated = failed = 0
    for candidate in subscriptions:
        checked += 1
        tenant_id = candidate.tenant_id
        try:
            live = _retrieve_authoritative_subscription(candidate.stripe_subscription_id or "")
            repository.lock_billing_tenant(db, tenant_id=tenant_id)
            locked = repository.lock_subscription_by_tenant(db, tenant_id=tenant_id)
            if locked is None:
                continue
            before = (
                locked.status,
                locked.current_period_end,
                locked.cancel_at_period_end,
                locked.canceled_at,
            )
            reconciled = _upsert_subscription_from_stripe_object(
                db, tenant_id=tenant_id, stripe_object=live
            )
            _set_watermark(
                reconciled,
                family=EVENT_FAMILY_LIFECYCLE,
                created_at=_now_utc(),
                event_id="internal-reconcile",
                event_type="customer.subscription.updated",
            )
            after = (
                reconciled.status,
                reconciled.current_period_end,
                reconciled.cancel_at_period_end,
                reconciled.canceled_at,
            )
            if before != after:
                updated += 1
                logger.warning(
                    "billing.reconciliation.divergence tenant_id=%s "
                    "previous_status=%s authoritative_status=%s",
                    tenant_id,
                    before[0],
                    after[0],
                )
            db.commit()
        except StripeSubscriptionError:
            failed += 1
            db.rollback()
            logger.exception("billing.reconciliation.lookup_failed tenant_id=%s", tenant_id)
    return {"checked": checked, "updated": updated, "failed": failed}

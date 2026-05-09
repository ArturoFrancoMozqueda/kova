import hashlib
import json
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.billing import repository
from app.billing.stripe_client import StripeCheckoutClient, StripeCheckoutError
from app.config import settings
from app.idempotency import service as idempotency_service
from app.shared.exceptions import bad_request

STANDARD_PLAN_NAME = "Standard Plan"
STANDARD_PLAN_AMOUNT_MINOR_UNITS = 19_900
STANDARD_PLAN_CURRENCY = "MXN"
STANDARD_PLAN_INTERVAL = "month"

checkout_client = StripeCheckoutClient()


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
    return (
        settings.stripe_secret_key,
        settings.stripe_standard_price_id,
        settings.stripe_checkout_success_url,
        settings.stripe_checkout_cancel_url,
    )


def get_subscription_status(db: Session, *, tenant_id: UUID) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    return {
        "plan": {
            "name": STANDARD_PLAN_NAME,
            "amount_minor_units": STANDARD_PLAN_AMOUNT_MINOR_UNITS,
            "currency": STANDARD_PLAN_CURRENCY,
            "interval": STANDARD_PLAN_INTERVAL,
        },
        "subscription": subscription,
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

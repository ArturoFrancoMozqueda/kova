import hmac

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.models import Membership, User, UserSession
from app.billing import repository, service
from app.billing.offers import public_offer
from app.billing.plans import tiered_pricing_enabled
from app.billing.schemas import (
    BillingSubscriptionResponse,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    InternalReconcileRequest,
    InternalReconcileResponse,
    InternalSubscriptionListResponse,
    PortalSessionResponse,
    PublicPlansResponse,
    ReconcileCheckoutRequest,
)
from app.config import settings
from app.db import get_db, get_privileged_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request, forbidden

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


def _internal_key_valid(provided: str | None) -> bool:
    """Constant-time check of the X-Internal-Key header. A missing server key or
    header always fails; bytes avoid compare_digest's ASCII-only str limit."""
    expected = settings.internal_api_key
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


def _require_verified_email(user: User) -> None:
    """Paid actions require a verified address.

    Sign-in no longer waits on email verification (see `app.auth.service.login`),
    so the check moved here: an owner can explore Kova and run their register
    unverified, but we will not take money from — or send a receipt to — an
    address nobody has confirmed.
    """
    if not user.is_email_verified:
        raise forbidden("Verify your email before starting a subscription")


@router.get("/plans", response_model=PublicPlansResponse)
def public_plans():
    return public_offer(tiered=tiered_pricing_enabled())


@router.get("/subscription", response_model=BillingSubscriptionResponse)
def subscription_status(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_subscription_status(db, tenant_id=membership.tenant_id, resync=True)


@router.post(
    "/checkout",
    response_model=CheckoutSessionResponse,
    status_code=201,
    dependencies=[Depends(rate_limit(5, key="billing-checkout"))],
)
def create_checkout_session(
    response: Response,
    body: CheckoutSessionRequest | None = None,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_MANAGE)
    ),
):
    user, membership, user_session = ctx
    _require_verified_email(user)
    status_code, response_body = service.create_checkout_session(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        idempotency_key=idempotency_key,
        plan_code=body.plan_code if body else None,
        session_id=user_session.id,
    )
    response.status_code = status_code
    return response_body


@router.post(
    "/checkout/reconcile",
    response_model=BillingSubscriptionResponse,
    dependencies=[Depends(rate_limit(10, key="billing-reconcile"))],
)
def reconcile_checkout(
    body: ReconcileCheckoutRequest,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.reconcile_checkout_session(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        session_id=body.checkout_session_id,
    )


@router.post("/cancel", response_model=BillingSubscriptionResponse)
def cancel_subscription(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.cancel_subscription(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
    )


@router.post(
    "/portal", response_model=PortalSessionResponse,
    dependencies=[Depends(rate_limit(5, key="billing-portal"))],
)
def create_portal_session(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_MANAGE)
    ),
):
    user, membership, _ = ctx
    _require_verified_email(user)
    return service.create_portal_session(db, tenant_id=membership.tenant_id, user_id=user.id)


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    # Stripe calls this unauthenticated, with no tenant context; it resolves the
    # tenant from the event and mutates subscriptions/webhook_events across
    # tenants. Privileged engine (RLS bypass); the handler scopes writes itself.
    db: Session = Depends(get_privileged_db),
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
):
    payload = await request.body()
    return await run_in_threadpool(
        service.process_stripe_webhook, db,
        payload=payload,
        signature_header=stripe_signature,
    )


@router.get(
    "/internal/subscriptions",
    response_model=InternalSubscriptionListResponse,
    tags=["internal"],
)
def internal_list_subscriptions(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    # Internal cross-tenant listing (guarded by the internal API key); has no
    # single-tenant context. Privileged engine (RLS bypass).
    db: Session = Depends(get_privileged_db),
):
    if not _internal_key_valid(x_internal_key):
        raise forbidden("Invalid or missing internal API key")
    items = repository.list_all_subscriptions(db, offset=offset, limit=limit)
    return InternalSubscriptionListResponse(items=items, total=len(items))


@router.post(
    "/internal/reconcile",
    response_model=InternalReconcileResponse,
    tags=["internal"],
)
def internal_reconcile_subscriptions(
    body: InternalReconcileRequest,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
):
    if not _internal_key_valid(x_internal_key):
        raise forbidden("Invalid or missing internal API key")
    return service.reconcile_subscriptions(db, limit=body.limit)

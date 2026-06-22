from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing import repository, service
from app.billing.schemas import (
    BillingSubscriptionResponse,
    CheckoutSessionResponse,
    InternalSubscriptionListResponse,
)
from app.config import settings
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request, forbidden

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


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
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_checkout_session(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


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


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
):
    payload = await request.body()
    return service.process_stripe_webhook(
        db,
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
    db: Session = Depends(get_db),
):
    if not settings.internal_api_key or x_internal_key != settings.internal_api_key:
        raise forbidden("Invalid or missing internal API key")
    items = repository.list_all_subscriptions(db, offset=offset, limit=limit)
    return InternalSubscriptionListResponse(items=items, total=len(items))

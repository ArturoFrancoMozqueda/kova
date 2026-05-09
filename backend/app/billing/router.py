from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing import service
from app.billing.schemas import BillingSubscriptionResponse, CheckoutSessionResponse
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request

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
    return service.get_subscription_status(db, tenant_id=membership.tenant_id)


@router.post("/checkout", response_model=CheckoutSessionResponse, status_code=201)
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

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing import service
from app.billing.schemas import BillingSubscriptionResponse
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


@router.get("/subscription", response_model=BillingSubscriptionResponse)
def subscription_status(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.BILLING_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_subscription_status(db, tenant_id=membership.tenant_id)

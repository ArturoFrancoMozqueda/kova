from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission, has_permission
from app.sync import service
from app.sync.schemas import OfflineSaleSyncRequest, OfflineSaleSyncResponse

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.post(
    "/offline-sales",
    response_model=OfflineSaleSyncResponse,
    dependencies=[Depends(rate_limit(60, key="sync-offline-sales"))],
)
def sync_offline_sales(
    body: OfflineSaleSyncRequest,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.ORDERS_CREATE)
    ),
):
    user, membership, _ = ctx
    return OfflineSaleSyncResponse(
        results=service.sync_offline_sales(
            db,
            tenant_id=membership.tenant_id,
            user_id=user.id,
            sales=body.sales,
            can_reconcile_lots=has_permission(membership.role, Permission.INVENTORY_ADJUST),
        )
    )

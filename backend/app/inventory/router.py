from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.inventory import service
from app.inventory.schemas import (
    InventoryAdjustmentCreate,
    InventoryMovementResponse,
    InventoryStockItem,
    LowStockThresholdUpdate,
    StockTakeCreate,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.get("/stock", response_model=list[InventoryStockItem])
def list_stock(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_stock(db, tenant_id=membership.tenant_id)


@router.get("/low-stock", response_model=list[InventoryStockItem])
def list_low_stock(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_low_stock(db, tenant_id=membership.tenant_id)


@router.post(
    "/products/{product_id}/adjustments",
    response_model=InventoryMovementResponse,
    status_code=201,
)
def adjust_stock(
    product_id: UUID,
    body: InventoryAdjustmentCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.adjust_stock(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        product_id=product_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post(
    "/products/{product_id}/stock-take",
    response_model=InventoryMovementResponse,
    status_code=201,
)
def stock_take(
    product_id: UUID,
    body: StockTakeCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.stock_take(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        product_id=product_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.patch("/products/{product_id}/low-stock-threshold", response_model=InventoryStockItem)
def update_low_stock_threshold(
    product_id: UUID,
    body: LowStockThresholdUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.update_low_stock_threshold(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        product_id=product_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body

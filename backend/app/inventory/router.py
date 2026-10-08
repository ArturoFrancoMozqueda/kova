from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.inventory import repository as repo
from app.inventory import service
from app.inventory.models import InventoryLot, InventoryLotAllocation
from app.inventory.schemas import (
    InventoryAdjustmentCreate,
    InventoryMovementResponse,
    InventoryStockItem,
    InventoryVelocityItem,
    LowStockThresholdUpdate,
    MovementHistoryResponse,
    StockTakeCreate,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
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


@router.get("/velocity", response_model=list[InventoryVelocityItem])
def inventory_velocity(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.inventory_velocity(db, tenant_id=membership.tenant_id)


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
        require_commercial_access(Permission.INVENTORY_ADJUST)
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
        require_commercial_access(Permission.INVENTORY_ADJUST)
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


@router.get("/products/{product_id}/movements", response_model=MovementHistoryResponse)
def list_movements(
    product_id: UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    items = repo.list_movements(
        db, tenant_id=membership.tenant_id, product_id=product_id, limit=limit, offset=offset
    )
    total = repo.count_movements(db, tenant_id=membership.tenant_id, product_id=product_id)
    allocation_map = {}
    for part, code in (
        db.query(InventoryLotAllocation, InventoryLot.code)
        .join(InventoryLot, InventoryLot.id == InventoryLotAllocation.lot_id)
        .filter(
            InventoryLotAllocation.tenant_id == membership.tenant_id,
            InventoryLotAllocation.movement_id.in_([m.id for m in items]),
        )
        .all()
    ):
        allocation_map.setdefault(part.movement_id, []).append(
            {"lot_id": part.lot_id, "quantity": abs(part.quantity_delta), "code": code}
        )
    return MovementHistoryResponse(
        items=[
            {
                "id": m.id,
                "movement_type": m.movement_type,
                "quantity_delta": m.quantity_delta,
                "stock_on_hand_after": m.stock_on_hand_after,
                "reason": m.reason,
                "reason_code": m.reason_code,
                "created_by_user_id": m.created_by_user_id,
                "created_at": m.created_at,
                "lot_allocations": allocation_map.get(m.id, []),
            }
            for m in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch("/products/{product_id}/low-stock-threshold", response_model=InventoryStockItem)
def update_low_stock_threshold(
    product_id: UUID,
    body: LowStockThresholdUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.INVENTORY_ADJUST)
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

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.inventory.router import _idempotency_key
from app.purchasing import service
from app.purchasing.schemas import (
    PurchaseCreate,
    PurchaseReceive,
    PurchaseResponse,
    SupplierCreate,
    SupplierResponse,
)
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/purchasing", tags=["purchasing"])
_access = require_commercial_access(Permission.INVENTORY_ADJUST)


@router.get("/suppliers", response_model=list[SupplierResponse])
def suppliers(db: Session = Depends(get_db), ctx=Depends(_access)):
    return service.suppliers(db, ctx[1].tenant_id)


@router.post("/suppliers", response_model=SupplierResponse, status_code=201)
def create_supplier(
    body: SupplierCreate,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
    key: str = Depends(_idempotency_key),
):
    response.status_code, result = service.create_supplier(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, body=body, key=key
    )
    return result


@router.get("/orders", response_model=list[PurchaseResponse])
def orders(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    return service.orders(db, ctx[1].tenant_id, limit, offset)


@router.post("/orders", response_model=PurchaseResponse, status_code=201)
def create_order(
    body: PurchaseCreate,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
    key: str = Depends(_idempotency_key),
):
    response.status_code, result = service.create_order(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, body=body, key=key
    )
    return result


@router.post("/orders/{order_id}/receive", response_model=PurchaseResponse)
def receive(
    order_id: UUID,
    body: PurchaseReceive,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
    key: str = Depends(_idempotency_key),
):
    response.status_code, result = service.receive(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, order_id=order_id, body=body, key=key
    )
    return result


@router.post("/orders/{order_id}/cancel", response_model=PurchaseResponse)
def cancel(
    order_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
    key: str = Depends(_idempotency_key),
):
    response.status_code, result = service.cancel(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, order_id=order_id, key=key
    )
    return result

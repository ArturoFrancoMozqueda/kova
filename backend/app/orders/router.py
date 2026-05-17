import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.orders import repository, service
from app.orders.schemas import (
    OrderCreate,
    OrderListResponse,
    OrderResponse,
    ReceiptResponse,
    RefundCreate,
    RefundResponse,
    VoidCreate,
    VoidResponse,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.get("", response_model=OrderListResponse)
def list_orders(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None, pattern="^(completed|voided)$"),
    start_date: datetime.date | None = Query(default=None),
    end_date: datetime.date | None = Query(default=None),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    filters = dict(status=status, start_date=start_date, end_date=end_date)
    items = repository.list_orders_by_tenant(
        db, tenant_id=membership.tenant_id, limit=limit, offset=offset, **filters
    )
    total = repository.count_orders_by_tenant(db, tenant_id=membership.tenant_id, **filters)
    return OrderListResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=OrderResponse, status_code=201)
def create_order(
    body: OrderCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.ORDERS_CREATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.get_order(db, tenant_id=membership.tenant_id, order_id=order_id)


@router.get("/{order_id}/receipt", response_model=ReceiptResponse)
def get_receipt(
    order_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.get_receipt(db, tenant_id=membership.tenant_id, order_id=order_id)


@router.post("/{order_id}/refunds", response_model=RefundResponse, status_code=201)
def create_refund(
    order_id: UUID,
    body: RefundCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.ORDERS_REFUND)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_refund(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get("/{order_id}/refunds")
def list_refunds(
    order_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.list_refunds(db, tenant_id=membership.tenant_id, order_id=order_id)


@router.get("/refunds/{refund_id}", response_model=RefundResponse)
def get_refund(
    refund_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return service.get_refund(db, tenant_id=membership.tenant_id, refund_id=refund_id)


@router.post("/{order_id}/void", response_model=VoidResponse, status_code=201)
def create_void(
    order_id: UUID,
    body: VoidCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.ORDERS_VOID)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_void(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        reason=body.reason,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body

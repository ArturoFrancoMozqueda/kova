from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.orders import service
from app.orders.schemas import OrderCreate, OrderResponse
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


@router.post("", response_model=OrderResponse, status_code=201)
def create_order(
    body: OrderCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.ORDERS_CREATE)
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

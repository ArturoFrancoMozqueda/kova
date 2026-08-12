from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.customer_orders import service
from app.customer_orders.schemas import (
    CustomerOrderCancel,
    CustomerOrderCheckout,
    CustomerOrderCheckoutResponse,
    CustomerOrderCreate,
    CustomerOrderListResponse,
    CustomerOrderResponse,
    CustomerOrderStatusChange,
    CustomerOrderUpdate,
    VersionedAction,
)
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, forbidden
from app.tenants import repository as tenant_repo
from app.tenants.feature_flags import CUSTOMER_ORDERS, resolve_feature_flags

router = APIRouter(prefix="/api/v1/customer-orders", tags=["customer-orders"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


def require_customer_orders(permission: Permission):
    def dependency(
        db: Session = Depends(get_db),
        ctx: tuple[User, Membership, UserSession] = Depends(require_commercial_access(permission)),
    ) -> tuple[User, Membership, UserSession]:
        _, membership, _ = ctx
        tenant = tenant_repo.get_by_id(db, membership.tenant_id)
        flags = resolve_feature_flags(tenant.feature_overrides if tenant else None)
        if not flags[CUSTOMER_ORDERS]:
            raise forbidden("El módulo de Pedidos no está habilitado para este negocio")
        return ctx

    return dependency


@router.get("", response_model=CustomerOrderListResponse)
def list_customer_orders(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=160),
    status: str | None = Query(
        default=None,
        pattern="^(new|confirmed|in_progress|ready|fulfilled|cancelled)$",
    ),
    payment_status: str | None = Query(
        default=None,
        pattern="^(unpaid|paid|partially_refunded|refunded|voided)$",
    ),
    fulfillment_type: str | None = Query(default=None, pattern="^(pickup|delivery)$"),
    promised_from: datetime | None = None,
    promised_to: datetime | None = None,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.list_customer_orders(
        db,
        tenant_id=membership.tenant_id,
        limit=limit,
        offset=offset,
        search=search,
        status=status,
        payment_status=payment_status,
        fulfillment_type=fulfillment_type,
        promised_from=promised_from,
        promised_to=promised_to,
    )


@router.post("", response_model=CustomerOrderResponse, status_code=201)
def create_customer_order(
    body: CustomerOrderCreate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_CREATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.create_customer_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get("/{order_id}", response_model=CustomerOrderResponse)
def get_customer_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_customer_order(db, tenant_id=membership.tenant_id, order_id=order_id)


@router.patch("/{order_id}", response_model=CustomerOrderResponse)
def update_customer_order(
    order_id: UUID,
    body: CustomerOrderUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.update_customer_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post("/{order_id}/confirm", response_model=CustomerOrderResponse)
def confirm_customer_order(
    order_id: UUID,
    body: VersionedAction,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.confirm_customer_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post("/{order_id}/status", response_model=CustomerOrderResponse)
def change_customer_order_status(
    order_id: UUID,
    body: CustomerOrderStatusChange,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_UPDATE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.change_customer_order_status(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        role=membership.role,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post("/{order_id}/cancel", response_model=CustomerOrderResponse)
def cancel_customer_order(
    order_id: UUID,
    body: CustomerOrderCancel,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_CANCEL)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.cancel_customer_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        role=membership.role,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.post(
    "/{order_id}/checkout",
    response_model=CustomerOrderCheckoutResponse,
    status_code=201,
)
def checkout_customer_order(
    order_id: UUID,
    body: CustomerOrderCheckout,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_customer_orders(Permission.CUSTOMER_ORDERS_CHECKOUT)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.checkout_customer_order(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body

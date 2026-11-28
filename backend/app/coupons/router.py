from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.coupons import service
from app.coupons.schemas import (
    CouponCheckout,
    CouponCreate,
    CouponPreview,
    CouponPreviewResponse,
    CouponResponse,
    CouponUpdate,
)
from app.db import get_db
from app.orders.schemas import OrderResponse
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/coupons", tags=["coupons"])
Ctx = tuple[User, Membership, UserSession]


@router.get("", response_model=list[CouponResponse])
def list_coupons(
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    return service.list_coupons(db, tenant_id=ctx[1].tenant_id)


# Creating and pausing coupons is a manager decision, like a manual discount.
@router.post("", response_model=CouponResponse, status_code=201)
def create_coupon(
    body: CouponCreate,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_DISCOUNT)),
):
    return service.create_coupon(db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, body=body)


@router.patch("/{coupon_id}", response_model=CouponResponse)
def update_coupon(
    coupon_id: UUID,
    body: CouponUpdate,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_DISCOUNT)),
):
    return service.update_coupon(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, coupon_id=coupon_id, body=body
    )


@router.post("/preview", response_model=CouponPreviewResponse)
def preview(
    body: CouponPreview,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    return service.preview(db, tenant_id=ctx[1].tenant_id, body=body)


@router.post("/checkout", response_model=OrderResponse, status_code=201)
def checkout(
    body: CouponCheckout,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    response.status_code, result = service.checkout(
        db, tenant_id=ctx[1].tenant_id, user_id=ctx[0].id, body=body, key=key or ""
    )
    return result

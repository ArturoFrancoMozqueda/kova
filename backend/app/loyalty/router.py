from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.loyalty import rewards, service
from app.loyalty.cards import create_link
from app.loyalty.schemas import (
    DigitalCardLink,
    LoyaltyAccountResponse,
    LoyaltyOverview,
    LoyaltyPolicyResponse,
    LoyaltyPolicyWrite,
    LoyaltyProcessResponse,
    LoyaltyRedeemWrite,
    LoyaltyRewardCheckout,
    LoyaltyRewardOffer,
    LoyaltyRewardResponse,
    LoyaltyRewardWrite,
)
from app.orders.schemas import OrderResponse
from app.rbac.permissions import Permission
from app.shared.exceptions import forbidden

router = APIRouter(prefix="/api/v1/loyalty", tags=["loyalty"])


def require_loyalty(ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE))):
    if ctx[1].role != "owner":
        raise forbidden("Sólo el propietario puede gestionar lealtad")
    return ctx


@router.get("/rewards", response_model=LoyaltyRewardResponse | None)
def reward_policy(db: Session = Depends(get_db), ctx=Depends(require_loyalty)):
    return rewards.describe(rewards.latest(db, ctx[1].tenant_id))


@router.put("/rewards", response_model=LoyaltyRewardResponse)
def save_reward_policy(
    body: LoyaltyRewardWrite, response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db), ctx=Depends(require_loyalty),
):
    response.status_code, result = rewards.save(db, ctx[1].tenant_id, ctx[0].id, body, key)
    return result


@router.get("/rewards/offer", response_model=LoyaltyRewardOffer)
def reward_offer(
    customer_id: UUID, db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    return rewards.offer(db, ctx[1].tenant_id, customer_id)


@router.post("/rewards/checkout", response_model=OrderResponse, status_code=201)
def reward_checkout(
    body: LoyaltyRewardCheckout, response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    response.status_code, result = rewards.checkout(db, ctx[1].tenant_id, ctx[0].id, body, key)
    return result


@router.get("", response_model=LoyaltyOverview)
def overview(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    return service.overview(db, ctx[1].tenant_id, limit, offset)


@router.put("/policy", response_model=LoyaltyPolicyResponse)
def policy(
    body: LoyaltyPolicyWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    response.status_code, result = service.save_policy(db, ctx[1].tenant_id, ctx[0].id, body, key)
    return result


@router.post("/process", response_model=LoyaltyProcessResponse)
def process(db: Session = Depends(get_db), ctx=Depends(require_loyalty)):
    created = service.process(db, ctx[1].tenant_id)
    db.commit()
    return {"created": created}


@router.get("/customers/{customer_id}", response_model=LoyaltyAccountResponse)
def account(
    customer_id: UUID,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    return service.account(db, ctx[1].tenant_id, customer_id, limit, offset)


@router.post("/customers/{customer_id}/digital-card", response_model=DigitalCardLink)
def digital_card(
    customer_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return create_link(db, ctx[1].tenant_id, ctx[0].id, customer_id)


@router.post(
    "/customers/{customer_id}/redeem", response_model=LoyaltyAccountResponse, status_code=201
)
def redeem(
    customer_id: UUID,
    body: LoyaltyRedeemWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    response.status_code, result = service.redeem(
        db, ctx[1].tenant_id, ctx[0].id, customer_id, body, key
    )
    return result

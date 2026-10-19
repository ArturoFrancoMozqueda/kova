from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.loyalty import service
from app.loyalty.schemas import (
    LoyaltyAccountResponse,
    LoyaltyOverview,
    LoyaltyPolicyResponse,
    LoyaltyPolicyWrite,
    LoyaltyProcessResponse,
    LoyaltyRedeemWrite,
)
from app.rbac.permissions import Permission
from app.shared.exceptions import forbidden

router = APIRouter(prefix="/api/v1/loyalty", tags=["loyalty"])


def require_loyalty(ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE))):
    if ctx[1].role != "owner":
        raise forbidden("Sólo el propietario puede gestionar lealtad")
    return ctx


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

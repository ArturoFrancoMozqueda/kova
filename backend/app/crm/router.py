from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.crm import service
from app.crm.schemas import (
    ConsentResponse,
    ConsentWrite,
    CrmOverview,
    OpportunityCreate,
    OpportunityResponse,
    OpportunityUpdate,
)
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.exceptions import forbidden

router = APIRouter(prefix="/api/v1/crm", tags=["crm"])


def require_crm(ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE))):
    if ctx[1].role not in {"owner", "manager"}:
        raise forbidden()
    return ctx


@router.get("", response_model=CrmOverview)
def get_overview(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    customer_id: UUID | None = None,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.overview(
        db, ctx[1].tenant_id, limit=limit, offset=offset, customer_id=customer_id
    )


@router.get("/opportunities/{opportunity_id}", response_model=OpportunityResponse)
def get_opportunity(
    opportunity_id: UUID,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.get_opportunity(db, ctx[1].tenant_id, opportunity_id)


@router.post("/opportunities", response_model=OpportunityResponse, status_code=201)
def create_opportunity(
    body: OpportunityCreate,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.create_opportunity(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result


@router.patch("/opportunities/{opportunity_id}", response_model=OpportunityResponse)
def update_opportunity(
    opportunity_id: UUID,
    body: OpportunityUpdate,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.update_opportunity(
        db,
        ctx[1].tenant_id,
        ctx[0].id,
        opportunity_id,
        body,
        key,
    )
    response.status_code = status
    return result


@router.put("/consents", response_model=ConsentResponse)
def save_consent(
    body: ConsentWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    status, result = service.save_consent(db, ctx[1].tenant_id, ctx[0].id, body, key)
    response.status_code = status
    return result

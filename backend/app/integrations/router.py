from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.integrations import service
from app.integrations.schemas import (
    FiscalIdentity,
    InvoiceRequestCreate,
    InvoiceRequestResponse,
    ReadinessResponse,
)
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@router.get("/readiness", response_model=ReadinessResponse)
def readiness(
    db: Session = Depends(get_db), ctx=Depends(require_commercial_access(Permission.FISCAL_VIEW))
):
    return service.readiness(db, ctx[1].tenant_id)


@router.put("/issuer", response_model=ReadinessResponse)
def save_issuer(
    body: FiscalIdentity,
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.FISCAL_MANAGE)),
):
    return service.save_issuer(db, ctx[1].tenant_id, body, user_id=ctx[0].id)


@router.get("/invoice-requests", response_model=list[InvoiceRequestResponse])
def list_requests(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.FISCAL_MANAGE)),
):
    return service.list_requests(db, ctx[1].tenant_id, limit, offset)


@router.post("/invoice-requests", response_model=InvoiceRequestResponse, status_code=201)
def create_request(
    body: InvoiceRequestCreate,
    response: Response,
    db: Session = Depends(get_db),
    key: str | None = Header(None, alias="Idempotency-Key"),
    ctx=Depends(require_commercial_access(Permission.FISCAL_MANAGE)),
):
    if not key or not key.strip() or len(key) > 200:
        raise bad_request("Idempotency-Key es obligatorio (máximo 200 caracteres)")
    status, result = service.create_request(db, ctx[1].tenant_id, body, key, user_id=ctx[0].id)
    response.status_code = status
    return result

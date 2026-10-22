from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.crm.router import require_crm
from app.db import get_db
from app.service_cases import service
from app.service_cases.schemas import (
    ServiceCaseAssigneeList,
    ServiceCaseCreate,
    ServiceCaseEventList,
    ServiceCaseList,
    ServiceCaseNoteWrite,
    ServiceCaseReferenceList,
    ServiceCaseResponse,
    ServiceCaseStatus,
    ServiceCaseUpdate,
)

router = APIRouter(prefix="/api/v1/service-cases", tags=["service-cases"])


@router.get("/assignees", response_model=ServiceCaseAssigneeList)
def assignees(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.assignees(db, ctx[1].tenant_id, limit=limit, offset=offset)


@router.get("/references", response_model=ServiceCaseReferenceList)
def references(
    customer_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.references(db, ctx[1].tenant_id, customer_id, limit=limit, offset=offset)


@router.get("", response_model=ServiceCaseList)
def listing(
    status: ServiceCaseStatus | None = None,
    customer_id: UUID | None = None,
    assigned_user_id: UUID | None = None,
    overdue_only: bool = False,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.listing(
        db,
        ctx[1].tenant_id,
        status=status,
        customer_id=customer_id,
        assigned_user_id=assigned_user_id,
        overdue_only=overdue_only,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ServiceCaseResponse, status_code=201)
def create(
    body: ServiceCaseCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.create(db, ctx[1].tenant_id, ctx[0].id, body, key)
    return result


@router.get("/{case_id}", response_model=ServiceCaseResponse)
def get(case_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.get(db, ctx[1].tenant_id, case_id)


@router.patch("/{case_id}", response_model=ServiceCaseResponse)
def update(
    case_id: UUID,
    body: ServiceCaseUpdate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.update(
        db, ctx[1].tenant_id, ctx[0].id, case_id, body, key
    )
    return result


@router.post("/{case_id}/notes", response_model=ServiceCaseResponse)
def note(
    case_id: UUID,
    body: ServiceCaseNoteWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.add_note(
        db, ctx[1].tenant_id, ctx[0].id, case_id, body, key
    )
    return result


@router.get("/{case_id}/events", response_model=ServiceCaseEventList)
def events(
    case_id: UUID,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.events(db, ctx[1].tenant_id, case_id, limit=limit, offset=offset)

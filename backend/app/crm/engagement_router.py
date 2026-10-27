from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.crm import engagement as service
from app.crm.engagement_schemas import (
    CatalogOrderAccept,
    CatalogOrderAcceptance,
    CatalogOrderPreview,
    CatalogRequestList,
    CatalogRequestResponse,
    FollowupOverview,
    FollowupProcessResponse,
    FollowupResponse,
    FollowupUpdate,
    IncidentWrite,
    PolicyResponse,
    PolicyWrite,
    RequestResolve,
)
from app.crm.router import require_crm
from app.customer_orders.router import require_customer_orders
from app.db import get_db
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/crm", tags=["crm-engagement"])


def require_order_intake(
    ctx=Depends(require_crm),
    _orders=Depends(require_customer_orders(Permission.CUSTOMER_ORDERS_CREATE)),
):
    return ctx


@router.get("/requests/{request_id}/order-preview", response_model=CatalogOrderPreview)
def order_preview(
    request_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_order_intake),
):
    from app.crm import order_intake

    return order_intake.preview(db, ctx[1].tenant_id, request_id)


@router.post("/requests/{request_id}/accept-order", response_model=CatalogOrderAcceptance)
def accept_order(
    request_id: UUID, body: CatalogOrderAccept, response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db), ctx=Depends(require_order_intake),
):
    from app.crm import order_intake

    response.status_code, result = order_intake.accept(
        db, ctx[1].tenant_id, ctx[0].id, request_id, body, key,
    )
    return result


@router.get("/requests", response_model=CatalogRequestList)
def requests(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.list_requests(db, ctx[1].tenant_id, limit, offset)


@router.post("/requests/{request_id}/resolve", response_model=CatalogRequestResponse)
def resolve(
    request_id: UUID,
    body: RequestResolve,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.resolve_request(
        db, ctx[1].tenant_id, ctx[0].id, request_id, body, key
    )
    return result


@router.get("/followups", response_model=FollowupOverview)
def followups(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.followup_overview(db, ctx[1].tenant_id, limit, offset)


@router.get("/followups/{task_id}", response_model=FollowupResponse)
def get_followup(task_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.get_followup(db, ctx[1].tenant_id, task_id)


@router.put("/followups/policy", response_model=PolicyResponse)
def policy(
    body: PolicyWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.save_policy(db, ctx[1].tenant_id, ctx[0].id, body, key)
    return result


@router.post("/followups/process", response_model=FollowupProcessResponse)
def process(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    created = service.process_due_followups(db, ctx[1].tenant_id)
    db.commit()
    return {"created": created}


@router.post("/followups", response_model=FollowupResponse, status_code=201)
def incident(
    body: IncidentWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.create_incident(
        db, ctx[1].tenant_id, ctx[0].id, body, key
    )
    return result


@router.patch("/followups/{task_id}", response_model=FollowupResponse)
def update(
    task_id: UUID,
    body: FollowupUpdate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.update_task(
        db, ctx[1].tenant_id, ctx[0].id, task_id, body, key
    )
    return result

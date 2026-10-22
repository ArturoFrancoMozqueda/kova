from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.quotes import service
from app.quotes.schemas import (
    QuoteAccept,
    QuoteAction,
    QuoteCreate,
    QuoteJourney,
    QuoteList,
    QuoteResponse,
    QuoteShared,
)
from app.rbac.permissions import Permission, has_permission
from app.shared.exceptions import forbidden

router = APIRouter(prefix="/api/v1/quotes", tags=["quotes"])
_access = require_commercial_access(Permission.SETTINGS_MANAGE)


def _conversion_access(ctx=Depends(_access)):
    if not has_permission(ctx[1].role, Permission.CUSTOMER_ORDERS_CREATE):
        raise forbidden()
    return ctx


@router.get("", response_model=QuoteList)
def list_quotes(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    return service.list_quotes(db, tenant_id=ctx[1].tenant_id, limit=limit, offset=offset)


@router.post("", response_model=QuoteResponse, status_code=201)
def create(
    body: QuoteCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    response.status_code, result = service.create(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        body=body,
        key=key,
    )
    return result


@router.get("/{quote_id}/journey", response_model=QuoteJourney)
def get_journey(
    quote_id: UUID,
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    return service.journey(db, tenant_id=ctx[1].tenant_id, quote_id=quote_id)


@router.post("/{quote_id}/mark-sent", response_model=QuoteResponse)
def mark_sent(
    quote_id: UUID,
    body: QuoteShared,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    response.status_code, result = service.mark_sent(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        quote_id=quote_id,
        body=body,
        key=key,
    )
    return result


@router.post("/{quote_id}/accept", response_model=QuoteResponse)
def accept(
    quote_id: UUID,
    body: QuoteAccept,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(_conversion_access),
):
    response.status_code, result = service.accept(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        quote_id=quote_id,
        body=body,
        key=key,
    )
    return result


@router.post("/{quote_id}/cancel", response_model=QuoteResponse)
def cancel(
    quote_id: UUID,
    body: QuoteAction,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(_access),
):
    response.status_code, result = service.cancel(
        db,
        tenant_id=ctx[1].tenant_id,
        user_id=ctx[0].id,
        quote_id=quote_id,
        body=body,
        key=key,
    )
    return result

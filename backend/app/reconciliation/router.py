from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.crm.router import require_crm
from app.db import get_db
from app.reconciliation import service
from app.reconciliation.parser import preview
from app.reconciliation.schemas import (
    BatchResponse,
    CommitRequest,
    EmptyAction,
    EntriesResponse,
    EntryResponse,
    MatchAction,
    PreviewRequest,
    ReconciliationPreviewResponse,
)

router = APIRouter(prefix="/api/v1/reconciliation", tags=["reconciliation"])


@router.post("/imports/preview", response_model=ReconciliationPreviewResponse)
def preview_import(body: PreviewRequest, _ctx=Depends(require_crm)):
    return preview(body.csv_content)


@router.post("/imports/commit", response_model=BatchResponse)
def commit_import(
    body: CommitRequest,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.commit_import(db, ctx[1].tenant_id, ctx[0].id, body, key)


@router.get("/entries", response_model=EntriesResponse)
def entries(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.list_entries(db, ctx[1].tenant_id, limit=limit, offset=offset)


@router.post("/entries/{entry_id}/suggest", response_model=EntryResponse)
def suggest(
    entry_id: UUID,
    body: EmptyAction,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.suggest(db, ctx[1].tenant_id, ctx[0].id, entry_id, body, key)


@router.post("/entries/{entry_id}/matches/{match_id}/{action}", response_model=EntryResponse)
def match_action(
    entry_id: UUID,
    match_id: UUID,
    action: str,
    body: MatchAction,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.act_on_match(
        db, ctx[1].tenant_id, ctx[0].id, entry_id, match_id, action, body, key
    )

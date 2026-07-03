from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import User
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.ops import repository, service
from app.ops.dependencies import InternalAdminContext, require_internal_admin
from app.ops.models import OpsNote
from app.ops.schemas import (
    FunnelResponse,
    FunnelWindow,
    NoteEntityType,
    NoteStatus,
    OpsMeResponse,
    OpsNoteCreate,
    OpsNoteListResponse,
    OpsNoteResponse,
    OpsNoteUpdate,
    OverviewResponse,
    RevenueResponse,
    TechnicalResponse,
    TenantListResponse,
)
from app.shared.exceptions import not_found

router = APIRouter(
    prefix="/api/v1/internal/ops",
    tags=["internal-ops"],
    dependencies=[Depends(rate_limit(60, key="internal-ops"))],
)

# Extra bucket for the module's only writes (notes/triage) on top of the
# router-wide limit.
_write_rate_limit = rate_limit(30, key="internal-ops-write")


def _note_response(note: OpsNote, author_email: str) -> OpsNoteResponse:
    return OpsNoteResponse(
        id=note.id,
        author_user_id=note.author_user_id,
        author_email=author_email,
        entity_type=note.entity_type,
        entity_source=note.entity_source,
        entity_external_id=note.entity_external_id,
        tenant_id=note.tenant_id,
        body=note.body,
        status=note.status,
        pinned=note.pinned,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.get("/me", response_model=OpsMeResponse)
def ops_me(
    ctx: InternalAdminContext = Depends(require_internal_admin),
) -> OpsMeResponse:
    return OpsMeResponse(email=ctx.user.email)


@router.get("/overview", response_model=OverviewResponse)
def ops_overview(
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> OverviewResponse:
    return service.build_overview(db)


@router.get("/technical", response_model=TechnicalResponse)
def ops_technical(
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> TechnicalResponse:
    return service.build_technical(db)


@router.get("/revenue", response_model=RevenueResponse)
def ops_revenue(
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> RevenueResponse:
    return service.build_revenue(db)


@router.get("/funnel", response_model=FunnelResponse)
def ops_funnel(
    window: FunnelWindow = Query(default="30d"),
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> FunnelResponse:
    return service.build_funnel(db, window=window)


@router.get("/tenants", response_model=TenantListResponse)
def ops_tenants(
    search: str | None = Query(default=None, max_length=255),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> TenantListResponse:
    return service.build_tenants(db, search=search, offset=offset, limit=limit)


@router.get("/notes", response_model=OpsNoteListResponse)
def list_notes(
    entity_type: NoteEntityType | None = Query(default=None),
    entity_source: str | None = Query(default=None, max_length=40),
    entity_external_id: str | None = Query(default=None, max_length=255),
    tenant_id: UUID | None = Query(default=None),
    status: NoteStatus | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> OpsNoteListResponse:
    rows, total = repository.list_notes(
        db,
        entity_type=entity_type,
        entity_source=entity_source,
        entity_external_id=entity_external_id,
        tenant_id=tenant_id,
        status=status,
        offset=offset,
        limit=limit,
    )
    return OpsNoteListResponse(
        items=[_note_response(note, email) for note, email in rows],
        total=total,
    )


@router.post(
    "/notes",
    response_model=OpsNoteResponse,
    status_code=201,
    dependencies=[Depends(_write_rate_limit)],
)
def create_note(
    body: OpsNoteCreate,
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> OpsNoteResponse:
    note = repository.create_note(
        db,
        author_user_id=ctx.user.id,
        entity_type=body.entity_type,
        entity_source=body.entity_source,
        entity_external_id=body.entity_external_id,
        tenant_id=body.tenant_id,
        body=body.body,
    )
    audit_service.log(
        db,
        action="ops_note_created",
        user_id=ctx.user.id,
        tenant_id=note.tenant_id,
        resource_type="ops_note",
        resource_id=note.id,
        changes={
            "entity_type": note.entity_type,
            "entity_source": note.entity_source,
            "entity_external_id": note.entity_external_id,
        },
    )
    db.commit()
    return _note_response(note, ctx.user.email)


@router.patch(
    "/notes/{note_id}",
    response_model=OpsNoteResponse,
    dependencies=[Depends(_write_rate_limit)],
)
def update_note(
    note_id: UUID,
    body: OpsNoteUpdate,
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> OpsNoteResponse:
    note = repository.get_note(db, note_id)
    if note is None:
        raise not_found("Note not found")
    changes: dict[str, object] = {}
    if body.body is not None and body.body != note.body:
        changes["body"] = "updated"
    if body.status is not None and body.status != note.status:
        changes["status"] = {"from": note.status, "to": body.status}
    if body.pinned is not None and body.pinned != note.pinned:
        changes["pinned"] = body.pinned
    note = repository.update_note(
        db, note, body=body.body, status=body.status, pinned=body.pinned
    )
    audit_service.log(
        db,
        action="ops_note_updated",
        user_id=ctx.user.id,
        tenant_id=note.tenant_id,
        resource_type="ops_note",
        resource_id=note.id,
        changes=changes or None,
    )
    db.commit()
    author = db.get(User, note.author_user_id)
    return _note_response(note, author.email if author else "")

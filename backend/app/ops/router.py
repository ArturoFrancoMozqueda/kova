from datetime import datetime
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
    IncidentDetailResponse,
    IncidentListResponse,
    IncidentSeverity,
    IncidentSource,
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
    TriageStatus,
    TriageUpdate,
)
from app.shared.exceptions import bad_request, not_found

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


@router.get("/incidents", response_model=IncidentListResponse)
def ops_incidents(
    severity: IncidentSeverity | None = Query(default=None),
    source: IncidentSource | None = Query(default=None),
    triage_status: TriageStatus | None = Query(default=None),
    since: datetime | None = Query(default=None),
    include_snoozed: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> IncidentListResponse:
    return service.build_incidents(
        db,
        severity=severity,
        source=source,
        triage_status=triage_status,
        since=since,
        include_snoozed=include_snoozed,
        limit=limit,
    )


def _split_key(incident_key: str) -> tuple[str, str]:
    source, _, external_id = incident_key.partition(":")
    if not source or not external_id:
        raise bad_request("Invalid incident key")
    return source, external_id


@router.get("/incidents/{incident_key:path}", response_model=IncidentDetailResponse)
def ops_incident_detail(
    incident_key: str,
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> IncidentDetailResponse:
    _split_key(incident_key)
    detail = service.build_incident_detail(db, key=incident_key)
    if detail is None:
        raise not_found("Incident not found")
    return detail


@router.patch(
    "/incidents/{incident_key:path}/triage",
    response_model=IncidentDetailResponse,
    dependencies=[Depends(_write_rate_limit)],
)
def ops_incident_triage(
    incident_key: str,
    body: TriageUpdate,
    ctx: InternalAdminContext = Depends(require_internal_admin),
    db: Session = Depends(get_db),
) -> IncidentDetailResponse:
    source, external_id = _split_key(incident_key)
    state = repository.upsert_incident_state(
        db,
        source=source,
        external_id=external_id,
        triage_status=body.triage_status,
        snoozed_until=body.snoozed_until,
        updated_by_user_id=ctx.user.id,
    )
    audit_service.log(
        db,
        action="ops_incident_triage",
        user_id=ctx.user.id,
        resource_type="ops_incident",
        changes={
            "source": source,
            "external_id": external_id,
            "triage_status": state.triage_status,
        },
    )
    db.commit()
    detail = service.build_incident_detail(db, key=incident_key)
    if detail is None:
        raise not_found("Incident not found")
    return detail


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

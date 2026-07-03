"""Cross-tenant read queries and ops-table writes.

Every query here runs WITHOUT the ``app.tenant_id`` RLS GUC (cleared by
``require_internal_admin``) and relies on the app DB role owning the tables.
Never call these from tenant-facing code paths.
"""
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import User
from app.ops.models import OpsNote


def _now() -> datetime:
    return datetime.now(UTC)


# ── Notes ───────────────────────────────────────────────────────────────────


def list_notes(
    db: Session,
    *,
    entity_type: str | None = None,
    entity_source: str | None = None,
    entity_external_id: str | None = None,
    tenant_id: UUID | None = None,
    status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[tuple[OpsNote, str]], int]:
    query = db.query(OpsNote, User.email).join(User, User.id == OpsNote.author_user_id)
    if entity_type is not None:
        query = query.filter(OpsNote.entity_type == entity_type)
    if entity_source is not None:
        query = query.filter(OpsNote.entity_source == entity_source)
    if entity_external_id is not None:
        query = query.filter(OpsNote.entity_external_id == entity_external_id)
    if tenant_id is not None:
        query = query.filter(OpsNote.tenant_id == tenant_id)
    if status is not None:
        query = query.filter(OpsNote.status == status)
    total = query.count()
    rows = (
        query.order_by(OpsNote.pinned.desc(), OpsNote.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return rows, total


def create_note(
    db: Session,
    *,
    author_user_id: UUID,
    entity_type: str,
    entity_source: str | None,
    entity_external_id: str | None,
    tenant_id: UUID | None,
    body: str,
) -> OpsNote:
    note = OpsNote(
        author_user_id=author_user_id,
        entity_type=entity_type,
        entity_source=entity_source,
        entity_external_id=entity_external_id,
        tenant_id=tenant_id,
        body=body,
    )
    db.add(note)
    db.flush()
    return note


def get_note(db: Session, note_id: UUID) -> OpsNote | None:
    return db.query(OpsNote).filter(OpsNote.id == note_id).first()


def update_note(
    db: Session,
    note: OpsNote,
    *,
    body: str | None = None,
    status: str | None = None,
    pinned: bool | None = None,
) -> OpsNote:
    if body is not None:
        note.body = body
    if status is not None:
        note.status = status
    if pinned is not None:
        note.pinned = pinned
    note.updated_at = _now()
    db.flush()
    return note

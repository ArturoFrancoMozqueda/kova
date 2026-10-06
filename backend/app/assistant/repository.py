from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_

from app.assistant.models import AssistantRecord, now


def records(db, tenant, user, kind, *, shared=False):
    query = db.query(AssistantRecord).filter(
        AssistantRecord.tenant_id == tenant, AssistantRecord.kind == kind
    )
    own = AssistantRecord.owner_user_id == user
    return query.filter(or_(own, AssistantRecord.shared.is_(True)) if shared else own)


def get(db, tenant, user, kind, record_id, *, shared=False, lock=False):
    query = records(db, tenant, user, kind, shared=shared).filter(AssistantRecord.id == record_id)
    if lock:
        query = query.with_for_update()
    row = query.populate_existing().first()
    if row is None:
        raise HTTPException(404, "Recurso no disponible.")
    return row


def create(
    db,
    tenant: UUID,
    user: UUID,
    branch: UUID,
    kind: str,
    data: dict,
    *,
    status="ready",
    parent=None,
    dedupe=None,
    shared=False,
    expires=None,
):
    row = AssistantRecord(
        tenant_id=tenant,
        owner_user_id=user,
        branch_id=branch,
        kind=kind,
        data=data,
        status=status,
        parent_id=parent,
        dedupe_key=dedupe,
        shared=shared,
        expires_at=expires,
    )
    db.add(row)
    db.flush()
    return row


def update(row, **values):
    row.data = {**row.data, **values}
    row.updated_at = now()


def sources_valid(db, tenant, user, data):
    from app.assistant.knowledge import valid_sources

    return valid_sources(
        db, tenant, user, [*data.get("source_ids", []), *data.get("evidence_ids", [])]
    ) and references_valid(db, tenant, user, data.get("context_refs", []))


def references_valid(db, tenant, user, refs):
    for ref in refs:
        if ref["kind"] not in {"memory", "goal"}:
            return False
        try:
            row = get(db, tenant, user, ref["kind"], UUID(ref["id"]), shared=True)
        except HTTPException:
            return False
        if row.updated_at.isoformat() != ref["updated_at"] or not sources_valid(
            db, tenant, user, row.data
        ):
            return False
    return True


def view(db, tenant, user, row):
    data = dict(row.data)
    # Private job internals, session IDs, invitation ciphertext and provider
    # bookkeeping never become a public DTO or LLM context.
    for key in ("session_id", "ciphertext", "lease_until", "remote_started", "file_hash"):
        data.pop(key, None)
    if not sources_valid(db, tenant, user, data):
        data = {
            "answer": "La fuente cambió o fue retirada. Vuelve a consultar.",
            "source_ids": [],
            "content": "Información retirada.",
        }
    return {
        "id": str(row.id),
        "kind": row.kind,
        "status": row.status,
        "branch_id": str(row.branch_id),
        "shared": row.shared,
        "can_edit": row.owner_user_id == user,
        "data": data,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }

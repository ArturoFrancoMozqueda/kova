import asyncio
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.assistant import budget, direct, documents, executor, knowledge, provider, storage
from app.assistant import repository as repo
from app.assistant.access import enabled, principal, require_enabled, scope
from app.assistant.models import now
from app.assistant.schemas import (
    Confirm,
    ConversationCreate,
    GoalWrite,
    MemoryWrite,
    MessageCreate,
    PreferenceWrite,
    ProposalCreate,
    ShareWrite,
    TaskWrite,
)
from app.billing.access import require_commercial_access
from app.config import settings
from app.db import get_db
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])
commercial = require_commercial_access(Permission.REPORTS_VIEW_ALL)


def limit_resources(db, tenant, user, kind, ceiling):
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    if repo.records(db, tenant, user, kind).count() >= ceiling:
        raise HTTPException(
            429, "Se alcanzó el límite de registros. Retira los que ya no necesitas."
        )


@router.get("/capabilities")
def capabilities(db=Depends(get_db), ctx=Depends(principal)):
    return {
        "enabled": enabled(ctx[1].tenant_id),
        "inference_ready": provider.ready(),
        "local_answers_ready": enabled(ctx[1].tenant_id),
        "provider_name": "Groq" if settings.assistant_generation_provider == "groq"
        else "Cloudflare",
        "configuration": settings.assistant_mutations_enabled and enabled(ctx[1].tenant_id),
        "documents": settings.assistant_documents_enabled
        and storage.ready()
        and enabled(ctx[1].tenant_id),
        "email": settings.assistant_email_enabled and enabled(ctx[1].tenant_id),
        "role": ctx[1].role,
    }


@router.get("/usage")
def usage(db=Depends(get_db), ctx=Depends(require_enabled)):
    return budget.usage(db, ctx[1].tenant_id, ctx[0].id)


@router.get("/conversations")
def conversations(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "conversation")
        .filter_by(branch_id=branch)
        .order_by(repo.AssistantRecord.updated_at.desc())
        .limit(50)
    ]


@router.post("/conversations", status_code=201)
def conversation_create(body: ConversationCreate, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    limit_resources(db, tenant, user, "conversation", 50)
    row = repo.create(db, tenant, user, branch, "conversation", body.model_dump())
    db.commit()
    return repo.view(db, tenant, user, row)


@router.get("/conversations/{identifier}")
def conversation_get(identifier: UUID, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    row = repo.get(db, tenant, user, "conversation", identifier)
    if row.branch_id != branch:
        raise HTTPException(409, "Selecciona la sucursal de esta conversación.")
    children = (
        repo.records(db, tenant, user, "message")
        .filter_by(parent_id=identifier)
        .order_by(repo.AssistantRecord.created_at)
        .limit(100)
    )
    return {
        "conversation": repo.view(db, tenant, user, row),
        "messages": [repo.view(db, tenant, user, r) for r in children],
    }


@router.delete("/conversations/{identifier}", status_code=204)
def conversation_delete(identifier: UUID, db=Depends(get_db), ctx=Depends(principal)):
    row = repo.get(db, ctx[1].tenant_id, ctx[0].id, "conversation", identifier, lock=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/conversations/{identifier}/messages", status_code=202, dependencies=[Depends(commercial)]
)
def message_create(
    identifier: UUID,
    body: MessageCreate,
    key: str = Header(alias="Idempotency-Key"),
    db=Depends(get_db),
    ctx=Depends(require_enabled),
):
    tenant, user, branch = scope(db, ctx)
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    row = repo.get(db, tenant, user, "conversation", identifier, lock=True)
    if row.branch_id != branch:
        raise HTTPException(409, "La sucursal cambió. Abre otra conversación.")
    if not 1 <= len(key) <= 100:
        raise HTTPException(422, "Clave de idempotencia inválida.")
    pref = repo.records(db, tenant, user, "preferences").first()
    if not pref or not provider.chat_consent_valid(pref.data):
        raise HTTPException(403, "Acepta el procesamiento externo antes de consultar.")
    content = knowledge.safe_text(body.content)
    digest = executor.fingerprint(
        {"content": content, "conversation": str(identifier), "branch": str(branch)}
    )
    dedupe = hashlib.sha256(key.encode()).hexdigest()
    replay = repo.records(db, tenant, user, "run").filter_by(dedupe_key=dedupe).first()
    if replay:
        if replay.data["request_hash"] != digest:
            raise HTTPException(409, "La clave ya se usó para otra consulta.")
        return repo.view(db, tenant, user, replay)
    if not provider.ready() and not direct.match(content):
        raise HTTPException(503, "El proveedor de IA aún no está configurado.")
    if (
        repo.records(db, tenant, user, "run")
        .filter(repo.AssistantRecord.status.in_(["queued", "running"]))
        .first()
    ):
        raise HTTPException(
            429, "Espera a que termine tu consulta actual.", headers={"Retry-After": "5"}
        )
    budget.turn(db, tenant, user)
    repo.create(
        db, tenant, user, branch, "message", {"role": "user", "content": content}, parent=identifier
    )
    job = repo.create(
        db,
        tenant,
        user,
        branch,
        "run",
        {"content": content, "request_hash": digest, "session_id": str(ctx[2].id)},
        parent=identifier,
        status="queued",
        dedupe=dedupe,
    )
    db.commit()
    return repo.view(db, tenant, user, job)


@router.get("/runs/{identifier}")
def run_get(identifier: UUID, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    row = repo.get(db, tenant, user, "run", identifier)
    if row.branch_id != branch:
        raise HTTPException(409, "La sucursal cambió.")
    return repo.view(db, tenant, user, row)


@router.post("/runs/{identifier}/cancel")
def run_cancel(identifier: UUID, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "run", identifier, lock=True)
    if row.status not in {"completed", "failed"}:
        row.status = "cancelled"
        db.commit()
    return repo.view(db, tenant, user, row)


@router.get("/proposals")
def proposals(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "proposal")
        .filter_by(branch_id=branch)
        .order_by(repo.AssistantRecord.created_at.desc())
        .limit(50)
    ]


@router.post("/proposals", status_code=201, dependencies=[Depends(commercial)])
def proposal_create(body: ProposalCreate, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    row = executor.prepare(db, ctx, branch, body.steps)
    db.commit()
    return repo.view(db, tenant, user, row)


@router.post("/proposals/{identifier}/revise", status_code=201, dependencies=[Depends(commercial)])
def proposal_revise(
    identifier: UUID, body: ProposalCreate, db=Depends(get_db), ctx=Depends(require_enabled)
):
    tenant, user, branch = scope(db, ctx)
    original = repo.get(db, tenant, user, "proposal", identifier, lock=True)
    if original.branch_id != branch or original.status != "pending_approval":
        raise HTTPException(409, "Solo puedes corregir una propuesta pendiente de revisión.")
    row = executor.prepare(db, ctx, branch, body.steps, parent=original.parent_id)
    original.status = "cancelled"
    db.commit()
    return repo.view(db, tenant, user, row)


@router.post("/proposals/{identifier}/confirm", dependencies=[Depends(commercial)])
def proposal_confirm(
    identifier: UUID, body: Confirm, db=Depends(get_db), ctx=Depends(require_enabled)
):
    tenant, user, branch = scope(db, ctx)
    row = executor.confirm(db, ctx, branch, identifier, body.fingerprint)
    return repo.view(db, tenant, user, row)


@router.post("/proposals/{identifier}/reject")
def proposal_reject(identifier: UUID, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "proposal", identifier, lock=True)
    if row.status != "completed":
        row.status = "cancelled"
        db.commit()
    return repo.view(db, tenant, user, row)


@router.get("/preferences")
def preferences(db=Depends(get_db), ctx=Depends(principal)):
    tenant, user, _ = scope(db, ctx)
    row = repo.records(db, tenant, user, "preferences").first()
    data = {k: v for k, v in row.data.items() if k in PreferenceWrite.model_fields} if row else {}
    data.update(chat_consent=bool(row and provider.chat_consent_valid(row.data)),
                chat_provider=settings.assistant_generation_provider)
    return PreferenceWrite.model_validate(data)


@router.put("/preferences")
def preferences_write(body: PreferenceWrite, db=Depends(get_db), ctx=Depends(principal)):
    tenant, user, branch = scope(db, ctx)
    if body.chat_consent and (body.chat_provider or "cloudflare") != (
        settings.assistant_generation_provider
    ):
        raise HTTPException(409, "El proveedor cambió. Revisa y acepta el permiso actualizado.")
    body.chat_provider = settings.assistant_generation_provider
    if body.email_opt_in and not ctx[0].is_email_verified:
        raise HTTPException(422, "Verifica tu correo antes de activar avisos.")
    row = (
        repo.records(db, tenant, user, "preferences")
        .filter_by(dedupe_key="preferences")
        .with_for_update()
        .first()
    )
    if not row:
        row = repo.create(db, tenant, user, branch, "preferences", {}, dedupe="preferences")
    repo.update(row, **body.model_dump(), consent_at=now().isoformat())
    db.commit()
    return body


@router.get("/memory")
def memory(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, _ = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "memory", shared=True)
        .order_by(repo.AssistantRecord.created_at)
        .limit(100)
    ]


@router.post("/memory", status_code=201)
def memory_create(body: MemoryWrite, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    limit_resources(db, tenant, user, "memory", 100)
    knowledge.safe_text(body.content)
    if not knowledge.valid_sources(db, tenant, user, body.source_ids):
        raise HTTPException(404, "Fuente no disponible.")
    row = repo.create(
        db,
        tenant,
        user,
        branch,
        "memory",
        body.model_dump(mode="json", exclude={"shared"}),
        shared=body.shared,
    )
    db.commit()
    return repo.view(db, tenant, user, row)


@router.put("/memory/{identifier}")
def memory_update(
    identifier: UUID, body: MemoryWrite, db=Depends(get_db), ctx=Depends(require_enabled)
):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "memory", identifier, lock=True)
    knowledge.safe_text(body.content)
    if not knowledge.valid_sources(db, tenant, user, body.source_ids):
        raise HTTPException(404, "Fuente no disponible.")
    row.data = body.model_dump(mode="json", exclude={"shared"})
    row.shared = body.shared
    row.updated_at = now()
    db.commit()
    return repo.view(db, tenant, user, row)


@router.delete("/memory/{identifier}", status_code=204)
def memory_delete(identifier: UUID, db=Depends(get_db), ctx=Depends(principal)):
    row = repo.get(db, ctx[1].tenant_id, ctx[0].id, "memory", identifier, lock=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/goals")
def goals(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "goal", shared=True)
        .filter_by(branch_id=branch)
        .limit(100)
    ]


@router.post("/goals", status_code=201)
def goal_create(body: GoalWrite, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    limit_resources(db, tenant, user, "goal", 20)
    if body.end_date < body.start_date or (body.end_date - body.start_date).days >= 92:
        raise HTTPException(422, "El objetivo admite un periodo válido de hasta 92 días.")
    row = repo.create(
        db,
        tenant,
        user,
        branch,
        "goal",
        body.model_dump(mode="json", exclude={"shared"}),
        shared=body.shared,
    )
    db.commit()
    return repo.view(db, tenant, user, row)


@router.put("/goals/{identifier}")
def goal_update(
    identifier: UUID, body: GoalWrite, db=Depends(get_db), ctx=Depends(require_enabled)
):
    tenant, user, branch = scope(db, ctx)
    row = repo.get(db, tenant, user, "goal", identifier, lock=True)
    if row.branch_id != branch:
        raise HTTPException(409, "Selecciona la sucursal de este objetivo.")
    if body.end_date < body.start_date or (body.end_date - body.start_date).days >= 92:
        raise HTTPException(422, "El objetivo admite un periodo válido de hasta 92 días.")
    row.data = body.model_dump(mode="json", exclude={"shared"})
    row.shared = body.shared
    row.updated_at = now()
    db.commit()
    return repo.view(db, tenant, user, row)


@router.delete("/goals/{identifier}", status_code=204)
def goal_delete(identifier: UUID, db=Depends(get_db), ctx=Depends(principal)):
    row = repo.get(db, ctx[1].tenant_id, ctx[0].id, "goal", identifier, lock=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/tasks")
def tasks(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, branch = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "task")
        .filter_by(branch_id=branch)
        .order_by(repo.AssistantRecord.updated_at.desc())
        .limit(100)
    ]


@router.patch("/tasks/{identifier}")
def task_write(identifier: UUID, body: TaskWrite, db=Depends(get_db), ctx=Depends(require_enabled)):
    row = repo.get(db, ctx[1].tenant_id, ctx[0].id, "task", identifier, lock=True)
    row.status = body.status
    row.updated_at = now()
    db.commit()
    return repo.view(db, ctx[1].tenant_id, ctx[0].id, row)


@router.get("/documents")
def document_list(db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, _ = scope(db, ctx)
    return [
        repo.view(db, tenant, user, r)
        for r in repo.records(db, tenant, user, "document", shared=True)
        .order_by(repo.AssistantRecord.created_at.desc())
        .limit(100)
    ]


@router.post("/documents", status_code=202, dependencies=[Depends(commercial)])
async def document_upload(
    request: Request,
    filename: str = Query(max_length=180),
    purpose: str = Query(pattern="^(knowledge|catalog)$"),
    replaces: UUID | None = Query(default=None),
    db=Depends(get_db),
    ctx=Depends(require_enabled),
):
    tenant, user, branch = scope(db, ctx)
    if not settings.assistant_documents_enabled or not storage.ready():
        raise HTTPException(503, "Las cargas privadas no están habilitadas.")
    if replaces:
        old = repo.get(db, tenant, user, "document", replaces)
        if purpose != "knowledge" or old.data.get("purpose") != "knowledge":
            raise HTTPException(422, "Solo se pueden reemplazar documentos de conocimiento.")
    from uuid import uuid4

    from app.assistant.models import AssistantRecord
    from app.assistant.worker import acquire, release

    lease = AssistantRecord(id=uuid4(), tenant_id=tenant, owner_user_id=user)
    if not acquire(db, lease):
        db.rollback()
        raise HTTPException(
            429, "Espera a que termine la carga actual.", headers={"Retry-After": "5"}
        )
    budget.charge(db, [(f"upload:{tenant}:{user}", 1, 20), (f"upload:{tenant}", 1, 50)])
    budget.charge(
        db, [(f"upload_hour:{tenant}:{user}", 1, 5)], window=now().strftime("%Y-%m-%dT%H")
    )
    db.commit()
    try:
        try:
            content = await asyncio.wait_for(request.body(), timeout=30)
        except TimeoutError:
            raise HTTPException(408, "La carga tardó demasiado. Vuelve a intentarlo.") from None
        budget.charge(db, [(f"upload_bytes:{tenant}", len(content), 200 * 1024 * 1024)])
        db.commit()
        row = await run_in_threadpool(
            documents.upload,
            db,
            ctx,
            branch,
            filename,
            purpose,
            content,
            charged=True,
            replaces=replaces,
        )
    finally:
        release(db, lease.id)
    return repo.view(db, tenant, user, row)


@router.get("/documents/{identifier}/source")
def document_source(identifier: UUID, db=Depends(get_db), ctx=Depends(require_enabled)):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "document", identifier, shared=True)
    if row.status != "ready":
        raise HTTPException(404, "Archivo no disponible.")
    return Response(
        storage.get(tenant, row.id),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="archivo-kova.' + row.data["format"] + '"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/documents/{identifier}/sharing")
def document_share(
    identifier: UUID, body: ShareWrite, db=Depends(get_db), ctx=Depends(require_enabled)
):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "document", identifier, lock=True)
    if body.shared and (row.data["purpose"] == "catalog" or row.status != "ready"):
        raise HTTPException(422, "Las importaciones se revisan en privado.")
    row.shared = body.shared
    row.updated_at = now()
    db.commit()
    return repo.view(db, tenant, user, row)


@router.delete("/documents/{identifier}", status_code=204)
def document_delete(identifier: UUID, db=Depends(get_db), ctx=Depends(principal)):
    tenant, user, _ = scope(db, ctx)
    row = repo.get(db, tenant, user, "document", identifier, lock=True)
    row.status = "deleting"
    db.commit()
    storage.delete(tenant, row.id)
    row = repo.get(db, tenant, user, "document", identifier, lock=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/export")
def personal_export(db=Depends(get_db), ctx=Depends(principal)):
    tenant, user, _ = scope(db, ctx)
    exported = {
        kind: [repo.view(db, tenant, user, r) for r in repo.records(db, tenant, user, kind)]
        for kind in ("conversation", "message", "memory", "goal", "document", "task")
    }
    return JSONResponse(
        exported,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'attachment; filename="kova-asistente.json"',
        },
    )

import base64
import hashlib
import json
import subprocess
import time
from pathlib import PurePosixPath

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant import budget, knowledge, provider, storage
from app.assistant import repository as repo
from app.assistant.models import AssistantChunk, now
from app.config import settings
from app.imports import service as imports


def upload(db, ctx, branch, filename, purpose, content, *, charged=False, replaces=None):
    user, member, session = ctx
    db.refresh(user)
    db.refresh(member)
    db.refresh(session)
    if (
        not user.is_active
        or not member.is_active
        or member.role not in {"owner", "manager"}
        or member.allowed_branch_id is not None
        or session.revoked_at
        or session.expires_at <= now()
    ):
        raise HTTPException(403, "La autorización dejó de estar vigente.")
    from app.assistant.access import enabled
    from app.billing.access import get_billing_access_status

    if (
        not enabled(member.tenant_id)
        or not get_billing_access_status(db, tenant_id=member.tenant_id).allowed
    ):
        raise HTTPException(403, "El acceso comercial dejó de estar vigente.")
    if not settings.assistant_documents_enabled or not storage.ready():
        raise HTTPException(503, "Las cargas privadas aún no están habilitadas.")
    filename = PurePosixPath(filename).name
    suffix = PurePosixPath(filename).suffix.lower()
    if (
        not filename
        or len(filename) > 180
        or suffix
        not in ({".csv", ".xlsx"} if purpose == "catalog" else {".pdf", ".docx", ".txt", ".md"})
    ):
        raise HTTPException(422, "Formato de archivo no admitido.")
    limit = 2 * 1024 * 1024 if purpose == "catalog" else 20 * 1024 * 1024
    if not 0 < len(content) <= limit:
        raise HTTPException(413, "El archivo supera el límite de tamaño.")
    if not charged:
        budget.charge(
            db,
            [
                (f"upload:{member.tenant_id}:{user.id}", 1, 20),
                (f"upload:{member.tenant_id}", 1, 50),
                (f"upload_bytes:{member.tenant_id}", len(content), 200 * 1024 * 1024),
            ],
        )
        budget.charge(
            db,
            [(f"upload_hour:{member.tenant_id}:{user.id}", 1, 5)],
            window=now().strftime("%Y-%m-%dT%H"),
        )
        db.commit()  # Bytes received remain charged even if validation rejects later.
    db.execute(text("SELECT pg_advisory_xact_lock(69850425)"))
    total = db.execute(
        text(
            "SELECT count(*),coalesce(sum(bytes),0) FROM assistant_control.objects "
            "WHERE tenant_key=:tenant"
        ),
        {"tenant": member.tenant_id},
    ).one()
    if total[0] >= 100 or total[1] + len(content) > 100 * 1024 * 1024:
        raise HTTPException(429, "Se alcanzó el límite de archivos del negocio.")
    metadata = {
        "filename": filename,
        "purpose": purpose,
        "format": suffix[1:],
        "sha256": hashlib.sha256(content).hexdigest(),
        "byte_size": len(content),
    }
    if replaces:
        metadata["replaces"] = str(replaces)
    if purpose == "catalog":
        metadata["preview"] = imports.validate_catalog_import(
            db, tenant_id=member.tenant_id, content=content, file_format=suffix[1:]
        )
    else:
        pref = repo.records(db, member.tenant_id, user.id, "preferences").first()
        if not pref or not pref.data.get("document_consent"):
            raise HTTPException(
                403, "Acepta el procesamiento externo de documentos antes de cargar."
            )
    doc = repo.create(
        db,
        member.tenant_id,
        user.id,
        branch,
        "document",
        metadata,
        status="uploading",
        expires=now() + __import__("datetime").timedelta(days=1),
    )
    db.execute(
        text(
            "INSERT INTO assistant_control.objects(id,tenant_key,bytes) VALUES (:id,:tenant,:size)"
        ),
        {"id": doc.id, "tenant": member.tenant_id, "size": len(content)},
    )
    db.commit()
    try:
        storage.put(member.tenant_id, doc.id, content)
        doc.status = "ready" if purpose == "catalog" else "queued"
        doc.expires_at = None
        db.commit()
    except Exception:
        db.rollback()
        doc = repo.get(db, member.tenant_id, user.id, "document", doc.id, lock=True)
        doc.status = "failed"
        repo.update(doc, error="La carga no terminó. Retira el archivo antes de volver a cargar.")
        db.commit()
        raise

    return doc


def authorize_document(db, ctx, identifier):
    from app.assistant.access import enabled
    from app.billing.access import get_billing_access_status

    user, member, _ = ctx
    db.refresh(user)
    db.refresh(member)
    pref = repo.records(db, member.tenant_id, user.id, "preferences").populate_existing().first()
    if (
        not enabled(member.tenant_id)
        or not settings.assistant_documents_enabled
        or not user.is_active
        or not member.is_active
        or member.role not in {"owner", "manager"}
        or not pref
        or not pref.data.get("document_consent")
        or not get_billing_access_status(db, tenant_id=member.tenant_id).allowed
    ):
        raise HTTPException(403, "La autorización para documentos dejó de estar vigente.")
    doc = repo.get(db, member.tenant_id, user.id, "document", identifier, lock=True)
    if doc.status not in {"running", "indexing"}:
        raise HTTPException(409, "El documento fue retirado o cancelado.")
    return doc


def ingest(db, ctx, doc):
    started = time.monotonic()
    user, member, _ = ctx
    identifier = doc.id
    doc = authorize_document(db, ctx, identifier)
    extracted = doc.data.get("extracted", False)
    if not extracted:
        # Reserve worst-case OCR CPU before extraction, including failed attempts.
        budget.charge(
            db,
            [(f"extract_cpu:{member.tenant_id}", 600 if doc.data["format"] == "pdf" else 60, 1800)],
        )
        db.commit()
        content = storage.get(member.tenant_id, identifier)
        if hashlib.sha256(content).hexdigest() != doc.data["sha256"]:
            raise HTTPException(422, "El archivo cambió.")
        payload = json.dumps(
            {"suffix": "." + doc.data["format"], "content": base64.b64encode(content).decode()}
        ).encode()
        try:
            result = subprocess.run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--read-only",
                    "--cap-drop",
                    "ALL",
                    "--security-opt",
                    "no-new-privileges",
                    "--memory",
                    "4g",
                    "--cpus",
                    "1",
                    "--pids-limit",
                    "64",
                    "--tmpfs",
                    "/tmp:size=256m,mode=1777",
                    "-i",
                    "kova-assistant-parser:1",
                ],
                input=payload,
                capture_output=True,
                timeout=600,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
            )
            if result.returncode != 0 or len(result.stdout) > 10 * 1024 * 1024:
                raise ValueError("parser")
            parsed = json.loads(result.stdout)
            pages = parsed["pages"]
            if (
                not isinstance(pages, list)
                or len(pages) > 200
                or not all(isinstance(p, str) for p in pages)
                or sum(len(p) for p in pages) > 2_000_000
            ):
                raise ValueError("text_limit")
            doc = authorize_document(db, ctx, identifier)
            # Validate every page before persisting any text or sending embeddings.
            pages = [knowledge.safe_document_text(page) for page in pages]
            position = 0
            for page_number, page in enumerate(pages, 1):
                for offset in range(0, len(page), 1700):
                    db.add(
                        AssistantChunk(
                            tenant_id=member.tenant_id,
                            document_id=doc.id,
                            position=position,
                            page=page_number,
                            content=knowledge.safe_text(page[offset : offset + 2000]),
                            embedding=None,
                        )
                    )
                    position += 1
            repo.update(
                doc,
                extracted=True,
                ocr=bool(parsed.get("ocr")),
                page_count=len(pages),
                chunk_count=position,
            )
            doc.status = "indexing"
            db.commit()
        except (ValueError, KeyError, OSError, subprocess.SubprocessError):
            raise HTTPException(
                422, "Archivo rechazado o analizador no disponible; no se envió a IA."
            ) from None
    while True:
        doc = authorize_document(db, ctx, identifier)
        pending = (
            db.query(AssistantChunk)
            .filter(
                AssistantChunk.tenant_id == member.tenant_id,
                AssistantChunk.document_id == identifier,
                AssistantChunk.embedding.is_(None),
            )
            .order_by(AssistantChunk.position)
            .limit(16)
            .all()
        )
        if not pending:
            if doc.data.get("replaces"):
                from uuid import UUID

                old = (
                    repo.records(db, member.tenant_id, user.id, "document")
                    .filter_by(id=UUID(doc.data["replaces"]))
                    .populate_existing()
                    .with_for_update()
                    .first()
                )
                if old:
                    old.status = "superseded"
                    old.expires_at = now()
            doc.status = "ready"
            repo.update(doc, embedding_started=False)
            db.commit()
            return
        budget.reserve(
            db,
            member.tenant_id,
            user.id,
            model=provider.EMBEDDING_MODEL,
            input_tokens=sum(len(c.content.encode()) for c in pending),
            output_tokens=0,
            background=True,
        )
        repo.update(doc, embedding_started=True)
        db.commit()
        vectors = provider.embed([c.content for c in pending])
        doc = authorize_document(db, ctx, identifier)
        for chunk, vector in zip(pending, vectors, strict=True):
            chunk.embedding = vector
        repo.update(doc, embedding_started=False, indexed_through=pending[-1].position)
        db.commit()
        if time.monotonic() - started > 120:
            doc.status = "queued"
            db.commit()
            return

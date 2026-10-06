"""Confirmed, version-bound configuration. Never callable as an LLM execution tool."""

import hashlib
import json
from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import inspect

from app.assistant import repository as repo
from app.assistant import storage
from app.assistant.access import enabled
from app.assistant.models import now
from app.assistant.schemas import Step
from app.audit.service import log
from app.auth.models import UserSession
from app.billing.access import get_billing_access_status
from app.branches.models import Branch
from app.branches.schemas import BranchWrite
from app.branches.service import save_branch
from app.business_settings import service as business
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.business_settings.schemas import BusinessProfileUpsert, ReceiptSettingsUpsert
from app.catalog import service as catalog
from app.catalog.models import Category, Product
from app.catalog.schemas import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate
from app.config import settings
from app.employees import service as employees
from app.employees.schemas import InvitationCreate
from app.imports import service as imports
from app.rbac.permissions import Permission, has_permission
from app.tenants.repository import lock_by_id

SCHEMAS = {
    "business_profile": BusinessProfileUpsert,
    "receipt": ReceiptSettingsUpsert,
    "category_create": CategoryCreate,
    "category_update": CategoryUpdate,
    "product_create": ProductCreate,
    "product_update": ProductUpdate,
    "branch_create": BranchWrite,
    "branch_update": BranchWrite,
    "invitation": InvitationCreate,
}
MODELS = {
    "business_profile": BusinessProfile,
    "receipt": ReceiptSettings,
    "category_update": Category,
    "product_update": Product,
    "branch_update": Branch,
}
PERMISSIONS = {name: Permission.CATALOG_UPDATE for name in SCHEMAS}
PERMISSIONS.update(
    {
        name: Permission.SETTINGS_MANAGE
        for name in ("business_profile", "receipt", "branch_create", "branch_update")
    }
)
PERMISSIONS.update(
    {
        "invitation": Permission.USERS_MANAGE,
        "catalog_import": Permission.CATALOG_CREATE,
        "category_create": Permission.CATALOG_CREATE,
        "product_create": Permission.CATALOG_CREATE,
    }
)
DENIED_FIELDS = {
    "tenant_id",
    "user_id",
    "branch_id",
    "image_url",
    "logo_url",
    "is_active",
    "image_position_x",
    "image_position_y",
    "image_zoom",
    "currency",
    "locale",
}
ALLOWED_FIELDS = {
    "business_profile": {"public_name", "support_email", "support_phone", "timezone"},
    "receipt": {"receipt_business_name", "footer", "tax_contact_text", "paper_width_mm"},
    "category_create": {"name", "description", "sort_order"},
    "category_update": {"name", "description", "sort_order"},
    "product_create": {
        "name",
        "description",
        "sku",
        "price_amount",
        "cost_price",
        "category_id",
        "track_inventory",
        "low_stock_threshold",
    },
    "product_update": {
        "name",
        "description",
        "sku",
        "price_amount",
        "cost_price",
        "category_id",
        "track_inventory",
        "low_stock_threshold",
    },
    "branch_create": {"name", "address"},
    "branch_update": {"name", "address"},
    "invitation": {"email", "role"},
    "catalog_import": {"document_id"},
}


def fingerprint(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()
    ).hexdigest()


def permission(member, action):
    if not has_permission(member.role, PERMISSIONS[action]):
        raise HTTPException(403, "No tienes permiso para esta configuración.")


def snapshot(db, tenant, step):
    model = MODELS.get(step.action)
    if model is None:
        return None
    query = db.query(model).filter(model.tenant_id == tenant)
    if step.action.endswith("_update"):
        if step.resource_id is None:
            raise HTTPException(422, "Selecciona el recurso que quieres modificar.")
        query = query.filter(model.id == step.resource_id)
    row = query.populate_existing().with_for_update().first()
    if row is None and step.action.endswith("_update"):
        raise HTTPException(404, "Recurso no disponible.")
    if row is None:
        return None
    return {
        column.key: getattr(row, column.key)
        for column in inspect(model).columns
        if column.key not in {"created_at", "updated_at", "tenant_id"}
    }


def prepare(db, ctx, branch, steps: list[Step], *, parent=None):
    if not settings.assistant_mutations_enabled:
        raise HTTPException(503, "La configuración por asistente aún no está habilitada.")
    user, member, session = ctx
    lock_by_id(db, member.tenant_id)
    prepared = []
    for i, step in enumerate(steps):
        permission(member, step.action)
        if step.values.keys() - ALLOWED_FIELDS[step.action]:
            raise HTTPException(422, "La propuesta contiene campos no permitidos.")
        if step.action == "catalog_import":
            if set(step.values) != {"document_id"}:
                raise HTTPException(422, "Importación inválida.")
            doc = repo.get(
                db, member.tenant_id, user.id, "document", UUID(step.values["document_id"])
            )
            if (
                doc.data.get("purpose") != "catalog"
                or doc.status != "ready"
                or doc.branch_id != branch
            ):
                raise HTTPException(409, "Revisa la importación en la sucursal activa.")
            before = doc.data["sha256"]
            body = {"document_id": str(doc.id)}
        else:
            before = snapshot(db, member.tenant_id, step)
            values = dict(step.values)
            reference = values.get("category_id")
            dependency = None
            if isinstance(reference, str) and reference.startswith("$step:"):
                try:
                    dependency = int(reference.split(":")[1])
                except ValueError:
                    raise HTTPException(422, "Dependencia inválida.") from None
                if (
                    dependency < 0
                    or dependency >= i
                    or prepared[dependency]["action"] != "category_create"
                ):
                    raise HTTPException(422, "La categoría debe crearse antes del producto.")
                values["category_id"] = None
            if step.action in {"business_profile", "receipt"}:
                original = {
                    key: value
                    for key, value in (before or {}).items()
                    if key in SCHEMAS[step.action].model_fields
                }
                values = {**original, **values}
            try:
                body = (
                    SCHEMAS[step.action]
                    .model_validate(values)
                    .model_dump(mode="json", exclude_unset=step.action.endswith("_update"))
                )
            except ValidationError:
                raise HTTPException(
                    422, "Revisa los campos de la configuración propuesta."
                ) from None
            if step.action == "business_profile":
                from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

                try:
                    ZoneInfo(body["timezone"])
                except (ZoneInfoNotFoundError, ValueError):
                    raise HTTPException(422, "Zona horaria inválida.") from None
            if values.get("category_id"):
                catalog._ensure_category(
                    db, tenant_id=member.tenant_id, category_id=UUID(str(values["category_id"]))
                )
            if dependency is not None:
                body["category_id"] = reference
            body = {key: value for key, value in body.items() if key in ALLOWED_FIELDS[step.action]}
        prepared.append(
            {
                "action": step.action,
                "resource_id": str(step.resource_id) if step.resource_id else None,
                "values": body,
                "before_hash": fingerprint(before),
                "before": json.loads(json.dumps(before, default=str)),
                "result": None,
            }
        )
    payload = {"steps": prepared, "branch_id": str(branch)}
    return repo.create(
        db,
        member.tenant_id,
        user.id,
        branch,
        "proposal",
        {**payload, "fingerprint": fingerprint(payload), "session_id": str(session.id)},
        parent=parent,
        status="pending_approval",
        expires=now() + timedelta(minutes=30),
    )


def confirm(db, ctx, branch, proposal_id, digest):
    user, member, session = ctx
    if not settings.assistant_mutations_enabled:
        raise HTTPException(503, "La configuración por asistente está deshabilitada.")
    proposal = repo.get(db, member.tenant_id, user.id, "proposal", proposal_id, lock=True)
    if proposal.branch_id != branch or proposal.data["fingerprint"] != digest:
        raise HTTPException(409, "La propuesta o sucursal cambió. Vuelve a revisarla.")
    if proposal.status == "completed":
        return proposal
    if proposal.expires_at < now() and proposal.status == "pending_approval":
        raise HTTPException(409, "La propuesta venció. Crea una nueva.")
    if proposal.status not in {"pending_approval", "partial", "approved"}:
        raise HTTPException(409, "Esta propuesta no puede ejecutarse.")
    # A resumed proposal is tied to the currently verified confirmation session.
    repo.update(proposal, session_id=str(session.id))
    proposal.status = "approved"
    db.commit()
    for index in range(len(proposal.data["steps"])):
        proposal = repo.get(db, member.tenant_id, user.id, "proposal", proposal_id, lock=True)
        if proposal.status not in {"approved", "partial"}:
            db.commit()
            return proposal
        if proposal.data["steps"][index]["result"] is not None:
            db.commit()
            continue
        try:
            db.refresh(member)
            db.refresh(user)
            active = db.get(UserSession, session.id)
            if (
                not member.is_active
                or member.role not in {"owner", "manager"}
                or member.allowed_branch_id is not None
                or not user.is_active
                or not active
                or active.revoked_at
                or active.expires_at <= now()
            ):
                raise HTTPException(403, "La autorización dejó de estar vigente.")
            if (
                not enabled(member.tenant_id)
                or not settings.assistant_mutations_enabled
                or not get_billing_access_status(db, tenant_id=member.tenant_id).allowed
            ):
                raise HTTPException(403, "La configuración no está disponible en este momento.")
            lock_by_id(db, member.tenant_id)
            steps = json.loads(json.dumps(proposal.data["steps"]))
            item = steps[index]
            step = Step.model_validate({k: item[k] for k in ("action", "resource_id", "values")})
            permission(member, step.action)
            before = snapshot(db, member.tenant_id, step)
            if step.action == "catalog_import":
                doc = repo.get(
                    db, member.tenant_id, user.id, "document", UUID(item["values"]["document_id"])
                )
                if doc.status != "ready" or doc.branch_id != branch:
                    raise HTTPException(409, "La importación cambió.")
                content = storage.get(member.tenant_id, doc.id)
                before = hashlib.sha256(content).hexdigest()
            if fingerprint(before) != item["before_hash"]:
                raise HTTPException(409, "Los datos cambiaron desde la vista previa.")
            values = dict(item["values"])
            reference = values.get("category_id")
            if isinstance(reference, str) and reference.startswith("$step:"):
                dependency = steps[int(reference.split(":")[1])]["result"]
                values["category_id"] = dependency["id"]
            key = f"assistant:{proposal.id}:{index}"
            if step.action == "catalog_import":
                _, result = imports.commit_catalog_import(
                    db,
                    tenant_id=member.tenant_id,
                    user_id=user.id,
                    content=content,
                    idempotency_key=key,
                    file_format=doc.data["format"],
                    commit=False,
                )
                result = {
                    k: result[k]
                    for k in ("created_products", "created_categories", "initial_stock_movements")
                }
            elif step.action in {"business_profile", "receipt"}:
                values = {
                    **{
                        key: value
                        for key, value in (before or {}).items()
                        if key in SCHEMAS[step.action].model_fields
                    },
                    **values,
                }
                func = (
                    business.upsert_business_profile
                    if step.action == "business_profile"
                    else business.upsert_receipt_settings
                )
                row = func(
                    db,
                    tenant_id=member.tenant_id,
                    user_id=user.id,
                    body=SCHEMAS[step.action].model_validate(values),
                    commit=False,
                )
                result = {"saved": True, "id": str(row.tenant_id)}
            elif step.action.startswith(("category_", "product_")):
                func = getattr(
                    catalog,
                    ("create_" if step.action.endswith("_create") else "update_")
                    + step.action.split("_")[0],
                )
                kwargs = (
                    {step.action.split("_")[0] + "_id": step.resource_id}
                    if step.action.endswith("_update")
                    else {}
                )
                _, result = func(
                    db,
                    tenant_id=member.tenant_id,
                    user_id=user.id,
                    body=SCHEMAS[step.action].model_validate(values),
                    idempotency_key=key,
                    commit=False,
                    **kwargs,
                )
            elif step.action.startswith("branch_"):
                _, result = save_branch(
                    db,
                    member,
                    BranchWrite.model_validate(values),
                    key,
                    user.id,
                    step.resource_id,
                    commit=False,
                )
            else:
                from app.assistant.notifications import queue_invitation

                row = employees.invite_employee(
                    db,
                    tenant_id=member.tenant_id,
                    user_id=user.id,
                    actor_role=member.role,
                    body=InvitationCreate.model_validate(values),
                    delivery_hook=lambda invitation, token: queue_invitation(
                        db, ctx, branch, invitation, token
                    ),
                )
                result = {"id": str(row.id), "delivery": "queued"}
            item["result"] = json.loads(json.dumps(result, default=str))
            log(
                db,
                tenant_id=member.tenant_id,
                user_id=user.id,
                action="assistant.configuration.applied",
                resource_type="assistant_proposal",
                resource_id=proposal.id,
                changes={"step": index, "action": step.action, "result": item["result"]},
            )
            repo.update(proposal, steps=steps)
            proposal.status = (
                "completed" if all(s["result"] is not None for s in steps) else "approved"
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            proposal = repo.get(db, member.tenant_id, user.id, "proposal", proposal_id, lock=True)
            proposal.status = (
                "partial"
                if any(s["result"] is not None for s in proposal.data["steps"])
                else "pending_approval"
            )
            repo.update(
                proposal,
                error="Los datos o permisos cambiaron. Revisa los pasos pendientes.",
                error_code=exc.status_code if isinstance(exc, HTTPException) else 503,
            )
            db.commit()
            return proposal
    return proposal

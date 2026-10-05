import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.branches.models import Branch
from app.branches.schemas import BranchResponse, BranchWrite
from app.db import get_db
from app.idempotency import service as idempotency
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import bad_request, conflict, not_found
from app.tenants.repository import lock_by_id

router = APIRouter(prefix="/api/v1/branches", tags=["branches"])


@router.get("", response_model=list[BranchResponse])
def list_branches(db: Session = Depends(get_db), ctx=Depends(get_current_session)):
    _, membership, _ = ctx
    return (
        db.query(Branch)
        .filter(Branch.tenant_id == membership.tenant_id)
        .order_by(Branch.created_at, Branch.name, Branch.id)
        .all()
    )


def _save(db, membership, body, key, user_id, branch_id=None):
    if not key:
        raise bad_request("Idempotency-Key header is required")
    fingerprint = hashlib.sha256(
        f"branch:{branch_id}:{body.model_dump_json()}".encode()
    ).hexdigest()
    replay = idempotency.claim(
        db, tenant_id=membership.tenant_id, key=key, request_hash=fingerprint
    )
    if replay:
        return replay.response_status, replay.response_body
    lock_by_id(db, membership.tenant_id)
    if branch_id is not None:
        branch = (
            db.query(Branch)
            .filter(Branch.tenant_id == membership.tenant_id, Branch.id == branch_id)
            .with_for_update()
            .first()
        )
        if branch is None:
            raise not_found("Sucursal no encontrada")
        branch.name = body.name
        branch.address = body.address
    else:
        count = db.query(Branch).filter(Branch.tenant_id == membership.tenant_id).count()
        if count >= 50:
            raise bad_request("El negocio ya tiene 50 sucursales")
        branch = Branch(tenant_id=membership.tenant_id, name=body.name, address=body.address)
        db.add(branch)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise conflict("Ya existe una sucursal con ese nombre") from None
    result = BranchResponse.model_validate(branch).model_dump(mode="json")
    status = 200 if branch_id is not None else 201
    idempotency.store(
        db,
        tenant_id=membership.tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=status,
        response_body=result,
    )
    audit.log(
        db,
        tenant_id=membership.tenant_id,
        user_id=user_id,
        action="branches.update" if branch_id else "branches.create",
        resource_type="branch",
        resource_id=branch.id,
        changes={"fields": ["name", "address"]},
    )
    db.commit()
    return status, result


@router.post("", response_model=BranchResponse, status_code=201)
def create_branch(
    body: BranchWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    status, result = _save(db, membership, body, key, user.id)
    response.status_code = status
    return result


@router.patch("/{branch_id}", response_model=BranchResponse)
def update_branch(
    branch_id: UUID,
    body: BranchWrite,
    response: Response,
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    status, result = _save(db, membership, body, key, user.id, branch_id)
    response.status_code = status
    return result

from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.branches.models import Branch
from app.branches.schemas import BranchResponse, BranchWrite
from app.branches.service import save_branch
from app.branches.transfers import router as transfers_router
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session

router = APIRouter(prefix="/api/v1/branches", tags=["branches"])

router.include_router(transfers_router)


@router.get("", response_model=list[BranchResponse])
def list_branches(db: Session = Depends(get_db), ctx=Depends(get_current_session)):
    _, membership, _ = ctx
    query = db.query(Branch)
    if membership.allowed_branch_id is not None:
        query = query.filter(Branch.id == membership.allowed_branch_id)
    return (
        query.filter(Branch.tenant_id == membership.tenant_id)
        .order_by(Branch.created_at, Branch.name, Branch.id)
        .all()
    )


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
    status, result = save_branch(db, membership, body, key, user.id)
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
    status, result = save_branch(db, membership, body, key, user.id, branch_id)
    response.status_code = status
    return result

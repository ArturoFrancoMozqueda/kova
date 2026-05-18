from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.employees import service
from app.employees.schemas import (
    EmployeeResponse,
    EmployeeRoleUpdate,
    InvitationCreate,
    InvitationResponse,
)
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission

router = APIRouter(prefix="/api/v1/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeResponse])
def list_employees(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    _, membership, _ = ctx
    return service.list_employees(db, tenant_id=membership.tenant_id)


@router.get("/invitations", response_model=list[InvitationResponse])
def list_invitations(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    _, membership, _ = ctx
    return service.list_invitations(db, tenant_id=membership.tenant_id)


@router.post("/invitations", response_model=InvitationResponse, status_code=201)
def invite_employee(
    body: InvitationCreate,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.invite_employee(
        db, tenant_id=membership.tenant_id, user_id=user.id, body=body
    )


@router.patch("/{membership_id}/role", response_model=EmployeeResponse)
def update_employee_role(
    membership_id: UUID,
    body: EmployeeRoleUpdate,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    user, membership, _ = ctx
    service.update_employee_role(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        membership_id=membership_id,
        body=body,
    )
    return service.employee_response(
        db, tenant_id=membership.tenant_id, membership_id=membership_id
    )


@router.delete("/{membership_id}", status_code=204)
def deactivate_employee(
    membership_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    user, membership, _ = ctx
    service.deactivate_employee(
        db, tenant_id=membership.tenant_id, user_id=user.id, membership_id=membership_id
    )
    return None

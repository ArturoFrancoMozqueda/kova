from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db, get_privileged_db
from app.employees import service
from app.employees.schemas import (
    EmployeeBranchUpdate,
    EmployeeResponse,
    EmployeeRoleUpdate,
    InvitationAccept,
    InvitationCreate,
    InvitationPreview,
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
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        actor_role=membership.role,
        body=body,
    )


@router.delete("/invitations/{invitation_id}", status_code=204)
def revoke_invitation(
    invitation_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.USERS_MANAGE)
    ),
):
    user, membership, _ = ctx
    service.revoke_invitation(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        invitation_id=invitation_id,
    )


@router.get("/invitations/preview", response_model=InvitationPreview)
def preview_invitation(
    token: str = Query(..., min_length=1),
    # Unauthenticated token-based lookup (invitee has no session/tenant context).
    # Privileged engine (RLS bypass); scoped by the single-use token hash.
    db: Session = Depends(get_privileged_db),
):
    return service.preview_invitation(db, token=token)


@router.post("/invitations/accept", response_model=InvitationResponse)
def accept_invitation(
    body: InvitationAccept,
    request: Request,
    # Unauthenticated accept: reads the invitation by token and creates the
    # user/membership before any session exists. Privileged engine (RLS bypass).
    db: Session = Depends(get_privileged_db),
):
    return service.accept_invitation(
        db,
        body=body,
        ip_address=request.client.host if request.client else None,
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
        actor_role=membership.role,
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
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        actor_role=membership.role,
        membership_id=membership_id,
    )
    return None


@router.patch("/{membership_id}/branch", response_model=EmployeeResponse)
def update_employee_branch(
    membership_id: UUID,
    body: EmployeeBranchUpdate,
    db: Session = Depends(get_db),
    ctx=Depends(require_permission(Permission.USERS_MANAGE)),
):
    user, membership, _ = ctx
    service.update_employee_branch(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        actor_role=membership.role,
        membership_id=membership_id,
        branch_id=body.allowed_branch_id,
    )
    return service.employee_response(
        db, tenant_id=membership.tenant_id, membership_id=membership_id
    )

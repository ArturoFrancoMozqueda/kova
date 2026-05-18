from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User
from app.employees.models import MembershipInvitation
from app.employees.schemas import EmployeeRoleUpdate, InvitationCreate
from app.shared.exceptions import bad_request, not_found


def list_employees(db: Session, *, tenant_id: UUID) -> list[dict]:
    rows = (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.tenant_id == tenant_id)
        .order_by(Membership.created_at.asc())
        .all()
    )
    return [
        {
            "membership_id": membership.id,
            "user_id": user.id,
            "email": user.email,
            "role": membership.role,
            "is_active": membership.is_active,
            "created_at": membership.created_at,
        }
        for membership, user in rows
    ]


def employee_response(db: Session, *, tenant_id: UUID, membership_id: UUID) -> dict:
    row = (
        db.query(Membership, User)
        .join(User, User.id == Membership.user_id)
        .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
        .first()
    )
    if row is None:
        raise not_found("Employee not found")
    membership, user = row
    return {
        "membership_id": membership.id,
        "user_id": user.id,
        "email": user.email,
        "role": membership.role,
        "is_active": membership.is_active,
        "created_at": membership.created_at,
    }


def list_invitations(db: Session, *, tenant_id: UUID) -> list[MembershipInvitation]:
    return (
        db.query(MembershipInvitation)
        .filter(MembershipInvitation.tenant_id == tenant_id)
        .order_by(MembershipInvitation.created_at.desc())
        .all()
    )


def invite_employee(
    db: Session, *, tenant_id: UUID, user_id: UUID, body: InvitationCreate
) -> MembershipInvitation:
    existing_membership = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            User.email == body.email,
            Membership.is_active.is_(True),
        )
        .first()
    )
    if existing_membership:
        raise bad_request("Employee already has access")

    invitation = MembershipInvitation(
        tenant_id=tenant_id,
        email=body.email.lower(),
        role=body.role,
        status="pending",
        invited_by_user_id=user_id,
        created_at=datetime.now(UTC),
    )
    db.add(invitation)
    db.flush()
    audit_service.log(
        db,
        action="employee.invited",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="membership_invitation",
        resource_id=invitation.id,
        changes={"email": invitation.email, "role": invitation.role},
    )
    db.commit()
    db.refresh(invitation)
    return invitation


def update_employee_role(
    db: Session, *, tenant_id: UUID, user_id: UUID, membership_id: UUID, body: EmployeeRoleUpdate
) -> Membership:
    membership = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
        .first()
    )
    if membership is None:
        raise not_found("Employee not found")
    membership.role = body.role
    audit_service.log(
        db,
        action="employee.role_updated",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="membership",
        resource_id=membership.id,
        changes={"role": body.role},
    )
    db.commit()
    db.refresh(membership)
    return membership


def deactivate_employee(
    db: Session, *, tenant_id: UUID, user_id: UUID, membership_id: UUID
) -> Membership:
    membership = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
        .first()
    )
    if membership is None:
        raise not_found("Employee not found")
    if membership.user_id == user_id:
        raise bad_request("You cannot deactivate your own access")
    membership.is_active = False
    audit_service.log(
        db,
        action="employee.deactivated",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="membership",
        resource_id=membership.id,
    )
    db.commit()
    db.refresh(membership)
    return membership

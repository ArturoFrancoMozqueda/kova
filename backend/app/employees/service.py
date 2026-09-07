import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth import repository as auth_repo
from app.auth import service as auth_service
from app.auth.models import Membership, User
from app.email import service as email_service
from app.employees.models import MembershipInvitation
from app.employees.schemas import EmployeeRoleUpdate, InvitationAccept, InvitationCreate
from app.shared.exceptions import bad_request, forbidden, not_found
from app.tenants import repository as tenant_repo

INVITATION_TTL_DAYS = 7
MIN_PASSWORD_LENGTH = 8


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _count_active_owners(db: Session, *, tenant_id: UUID) -> int:
    return (
        db.query(Membership)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.role == "owner",
            Membership.is_active.is_(True),
        )
        .count()
    )


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


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
    db: Session, *, tenant_id: UUID, user_id: UUID, actor_role: str, body: InvitationCreate
) -> MembershipInvitation:
    # Only an owner can grant owner-level access. USERS_MANAGE alone (managers)
    # must not be able to mint owners — that would be privilege escalation.
    if body.role == "owner" and actor_role != "owner":
        raise forbidden("Solo un propietario puede invitar a otro propietario")

    email_norm = body.email.strip().lower()
    existing_membership = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            User.email == email_norm,
        )
        .first()
    )
    if existing_membership and existing_membership.is_active:
        raise bad_request("Employee already has access")

    # Revoke any prior pending invitation for the same email so the unique
    # (tenant_id, email, status='pending') constraint stays satisfied and the
    # old link stops working.
    now = datetime.now(UTC)
    db.query(MembershipInvitation).filter(
        MembershipInvitation.tenant_id == tenant_id,
        MembershipInvitation.email == email_norm,
        MembershipInvitation.status == "pending",
    ).update({"status": "revoked", "revoked_at": now})

    plain_token = _generate_token()
    invitation = MembershipInvitation(
        tenant_id=tenant_id,
        email=email_norm,
        role=body.role,
        status="pending",
        invited_by_user_id=user_id,
        token_hash=_hash_token(plain_token),
        expires_at=now + timedelta(days=INVITATION_TTL_DAYS),
        created_at=now,
    )
    db.add(invitation)
    db.flush()

    inviter = auth_repo.get_user_by_id(db, user_id)
    tenant = tenant_repo.get_by_id(db, tenant_id)

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
    email_service.send_invitation_email(
        to=invitation.email,
        token=plain_token,
        tenant_name=tenant.name if tenant else "Kova",
        role=invitation.role,
        invited_by_email=inviter.email if inviter else None,
    )
    return invitation


def revoke_invitation(
    db: Session, *, tenant_id: UUID, user_id: UUID, invitation_id: UUID
) -> None:
    """Revoke a pending invitation so its link stops working. Tenant-scoped:
    an invitation from another tenant is treated as not found, never revealed.
    Only pending invitations can be revoked (already-accepted/revoked ones are
    a no-op error rather than silently mutating final state)."""
    invitation = (
        db.query(MembershipInvitation)
        .filter(
            MembershipInvitation.id == invitation_id,
            MembershipInvitation.tenant_id == tenant_id,
        )
        .first()
    )
    if invitation is None:
        raise not_found("Invitation not found")
    if invitation.status != "pending":
        raise bad_request("Invitation is no longer pending")

    invitation.status = "revoked"
    invitation.revoked_at = datetime.now(UTC)

    audit_service.log(
        db,
        action="employee.invitation_revoked",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="membership_invitation",
        resource_id=invitation.id,
        changes={"email": invitation.email, "role": invitation.role},
    )
    db.commit()


def preview_invitation(db: Session, *, token: str) -> dict:
    """Return tenant name + email + role for the invitation accept screen."""
    invitation = (
        db.query(MembershipInvitation)
        .filter(MembershipInvitation.token_hash == _hash_token(token))
        .first()
    )
    if invitation is None:
        raise bad_request("Invitation not found")
    if invitation.status != "pending":
        raise bad_request("Invitation no longer valid")
    expires_at = invitation.expires_at
    if expires_at is None or expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise bad_request("Invitation expired")
    tenant = tenant_repo.get_by_id(db, invitation.tenant_id)
    user = auth_repo.get_user_by_email(db, invitation.email)
    return {
        "email": invitation.email,
        "role": invitation.role,
        "tenant_name": tenant.name if tenant else "",
        "requires_password": user is None,
    }


def accept_invitation(
    db: Session, *, body: InvitationAccept, ip_address: str | None = None
) -> MembershipInvitation:
    invitation = (
        db.query(MembershipInvitation)
        .filter(MembershipInvitation.token_hash == _hash_token(body.token))
        .first()
    )
    if invitation is None:
        raise bad_request("Invitation not found")
    if invitation.status != "pending":
        raise bad_request("Invitation no longer valid")
    expires_at = invitation.expires_at
    if expires_at is None or expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        raise bad_request("Invitation expired")

    user = auth_repo.get_user_by_email(db, invitation.email)
    if user is None:
        if not body.password or len(body.password) < MIN_PASSWORD_LENGTH:
            raise bad_request(
                f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
            )
        user = auth_repo.create_user(
            db,
            email=invitation.email,
            hashed_password=auth_service.hash_password(body.password),
        )
        # Invitee accepted via the email link → email is verified.
        auth_repo.set_email_verified(db, user)

    existing_membership = auth_repo.get_membership_including_inactive(
        db, user_id=user.id, tenant_id=invitation.tenant_id
    )
    if existing_membership is None:
        auth_repo.create_membership(
            db,
            tenant_id=invitation.tenant_id,
            user_id=user.id,
            role=invitation.role,
        )
    elif not existing_membership.is_active:
        existing_membership.is_active = True
        existing_membership.role = invitation.role

    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(UTC)

    audit_service.log(
        db,
        action="employee.invitation_accepted",
        tenant_id=invitation.tenant_id,
        user_id=user.id,
        resource_type="membership_invitation",
        resource_id=invitation.id,
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(invitation)
    return invitation


def update_employee_role(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    actor_role: str,
    membership_id: UUID,
    body: EmployeeRoleUpdate,
) -> Membership:
    tenant_repo.lock_by_id(db, tenant_id)
    membership = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
        .first()
    )
    if membership is None:
        raise not_found("Employee not found")

    # Granting owner, or touching an existing owner's role, is owner-only.
    if (body.role == "owner" or membership.role == "owner") and actor_role != "owner":
        raise forbidden("Solo un propietario puede cambiar el rol de un propietario")

    # Never strand the tenant without an owner.
    if (
        membership.role == "owner"
        and body.role != "owner"
        and _count_active_owners(db, tenant_id=tenant_id) <= 1
    ):
        raise bad_request("No puedes quitar al último propietario del negocio")

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
    db: Session, *, tenant_id: UUID, user_id: UUID, actor_role: str, membership_id: UUID
) -> Membership:
    tenant_repo.lock_by_id(db, tenant_id)
    membership = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
        .first()
    )
    if membership is None:
        raise not_found("Employee not found")
    if membership.user_id == user_id:
        raise bad_request("You cannot deactivate your own access")

    # Only an owner can remove another owner, and never the last one.
    if membership.role == "owner":
        if actor_role != "owner":
            raise forbidden("Solo un propietario puede desactivar a otro propietario")
        if _count_active_owners(db, tenant_id=tenant_id) <= 1:
            raise bad_request("No puedes desactivar al último propietario del negocio")

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

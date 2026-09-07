"""Owner-role management hardening.

Two protections, verified mostly at the service layer because only `owner`
holds USERS_MANAGE today, so non-owner actors never reach these endpoints
through the permission gate (the forbidden branches are defense-in-depth):

1. Only an owner may grant the `owner` role or modify/deactivate an existing
   owner — prevents privilege escalation if USERS_MANAGE is ever widened.
2. The last active owner cannot be demoted or deactivated — prevents locking a
   tenant out of all owner-only functions (billing, user management). This one
   is reachable today via the API by an owner acting on themselves.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, BrokenBarrierError
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth import repository as auth_repo
from app.auth import service as auth_service
from app.auth.models import Membership, User
from app.employees import service
from app.employees.models import MembershipInvitation
from app.employees.schemas import EmployeeRoleUpdate, InvitationAccept, InvitationCreate
from app.tenants.models import Tenant


def _signup(client: TestClient, email: str, tenant: str) -> dict:
    r = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant, "accepted_terms": True},
    )
    assert r.status_code == 201, r.text
    signup = r.json()
    client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    return signup


def _owner_membership(db, signup: dict) -> Membership:
    return (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )


def _add_member(db, *, tenant_id: UUID, role: str) -> Membership:
    user = auth_repo.create_user(
        db,
        email=f"member-{uuid4().hex}@example.com",
        hashed_password=auth_service.hash_password("S3cur3pass!"),
    )
    auth_repo.set_email_verified(db, user)
    membership = auth_repo.create_membership(db, tenant_id=tenant_id, user_id=user.id, role=role)
    db.commit()
    return membership


# ── Owner-grant guard (service layer) ───────────────────────────────────────

def test_manager_cannot_invite_owner(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Invite")
    with pytest.raises(HTTPException) as exc:
        service.invite_employee(
            db,
            tenant_id=UUID(signup["tenant_id"]),
            user_id=UUID(signup["user_id"]),
            actor_role="manager",
            body=InvitationCreate(email=f"x-{uuid4().hex}@example.com", role="owner"),
        )
    assert exc.value.status_code == 403


def test_owner_can_invite_owner(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Invite OK")
    invitation = service.invite_employee(
        db,
        tenant_id=UUID(signup["tenant_id"]),
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=f"newowner-{uuid4().hex}@example.com", role="owner"),
    )
    assert invitation.role == "owner"


def test_manager_cannot_promote_to_owner(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Promote")
    tenant_id = UUID(signup["tenant_id"])
    target = _add_member(db, tenant_id=tenant_id, role="cashier")
    with pytest.raises(HTTPException) as exc:
        service.update_employee_role(
            db,
            tenant_id=tenant_id,
            user_id=UUID(signup["user_id"]),
            actor_role="manager",
            membership_id=target.id,
            body=EmployeeRoleUpdate(role="owner"),
        )
    assert exc.value.status_code == 403


def test_owner_can_promote_to_owner(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Promote OK")
    tenant_id = UUID(signup["tenant_id"])
    target = _add_member(db, tenant_id=tenant_id, role="cashier")
    updated = service.update_employee_role(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        membership_id=target.id,
        body=EmployeeRoleUpdate(role="owner"),
    )
    assert updated.role == "owner"


def test_manager_cannot_change_owner_role(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Touch Owner")
    tenant_id = UUID(signup["tenant_id"])
    other_owner = _add_member(db, tenant_id=tenant_id, role="owner")
    with pytest.raises(HTTPException) as exc:
        service.update_employee_role(
            db,
            tenant_id=tenant_id,
            user_id=UUID(signup["user_id"]),
            actor_role="manager",
            membership_id=other_owner.id,
            body=EmployeeRoleUpdate(role="cashier"),
        )
    assert exc.value.status_code == 403


def test_manager_cannot_deactivate_owner(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Deactivate Owner")
    tenant_id = UUID(signup["tenant_id"])
    other_owner = _add_member(db, tenant_id=tenant_id, role="owner")
    with pytest.raises(HTTPException) as exc:
        service.deactivate_employee(
            db,
            tenant_id=tenant_id,
            user_id=UUID(signup["user_id"]),
            actor_role="manager",
            membership_id=other_owner.id,
        )
    assert exc.value.status_code == 403


# ── Last-owner protection (reachable via API by an owner) ────────────────────

def test_cannot_demote_last_owner_via_api(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Last Owner")
    membership = _owner_membership(db, signup)
    r = client.patch(f"/api/v1/employees/{membership.id}/role", json={"role": "cashier"})
    assert r.status_code == 400, r.text


def test_second_owner_can_be_demoted(client, db):
    """With two owners, demoting one is allowed (only the LAST owner is protected)."""
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Two Owners")
    tenant_id = UUID(signup["tenant_id"])
    second_owner = _add_member(db, tenant_id=tenant_id, role="owner")
    updated = service.update_employee_role(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        membership_id=second_owner.id,
        body=EmployeeRoleUpdate(role="manager"),
    )
    assert updated.role == "manager"


def test_concurrent_cross_deactivation_preserves_one_active_owner(owner_engine):
    seed = Session(owner_engine)
    tenant = Tenant(name="Concurrent Owners", slug=f"owners-{uuid4().hex}")
    seed.add(tenant)
    seed.flush()
    owner_a = _add_member(seed, tenant_id=tenant.id, role="owner")
    owner_b = _add_member(seed, tenant_id=tenant.id, role="owner")
    tenant_id = tenant.id
    owner_ids = (owner_a.id, owner_b.id)
    user_ids = (owner_a.user_id, owner_b.user_id)
    seed.close()
    barrier = Barrier(2)

    def deactivate(*, actor_user_id: UUID, target_membership_id: UUID) -> int:
        session = Session(owner_engine)
        try:
            barrier.wait(timeout=5)
            service.deactivate_employee(
                session,
                tenant_id=tenant_id,
                user_id=actor_user_id,
                actor_role="owner",
                membership_id=target_membership_id,
            )
            return 200
        except HTTPException as exc:
            session.rollback()
            return exc.status_code
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(
            deactivate,
            actor_user_id=user_ids[0],
            target_membership_id=owner_ids[1],
        )
        second = pool.submit(
            deactivate,
            actor_user_id=user_ids[1],
            target_membership_id=owner_ids[0],
        )
        results = sorted((first.result(timeout=10), second.result(timeout=10)))

    verify = Session(owner_engine)
    try:
        active_owners = (
            verify.query(Membership)
            .filter(
                Membership.tenant_id == tenant_id,
                Membership.role == "owner",
                Membership.is_active.is_(True),
            )
            .count()
        )
        assert results == [200, 400]
        assert active_owners == 1
    finally:
        verify.query(Membership).filter(Membership.tenant_id == tenant_id).delete()
        verify.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
        verify.query(Tenant).filter(Tenant.id == tenant_id).delete()
        verify.commit()
        verify.close()


# ── Invitation revoke ───────────────────────────────────────────────────────


def _invite(db, signup: dict) -> MembershipInvitation:
    return service.invite_employee(
        db,
        tenant_id=UUID(signup["tenant_id"]),
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=f"invitee-{uuid4().hex}@example.com", role="cashier"),
    )


def test_reinvite_reactivates_existing_membership_without_duplicate(client, db, monkeypatch):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Reactivate")
    tenant_id = UUID(signup["tenant_id"])
    employee = _add_member(db, tenant_id=tenant_id, role="cashier")
    employee.is_active = False
    employee_email = auth_repo.get_user_by_id(db, employee.user_id).email
    db.commit()
    token = "synthetic-reactivation-token"
    monkeypatch.setattr(service, "_generate_token", lambda: token)

    invitation = service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=employee_email, role="manager"),
    )
    service.accept_invitation(db, body=InvitationAccept(token=token, password=None))

    memberships = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.user_id == employee.user_id)
        .all()
    )
    assert invitation.status == "accepted"
    assert len(memberships) == 1
    assert memberships[0].is_active is True
    assert memberships[0].role == "manager"


def test_reinvite_revokes_old_token_without_reactivating_membership(client, db, monkeypatch):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Old Invitation")
    tenant_id = UUID(signup["tenant_id"])
    employee = _add_member(db, tenant_id=tenant_id, role="cashier")
    employee.is_active = False
    employee_email = auth_repo.get_user_by_id(db, employee.user_id).email
    db.commit()
    tokens = iter(("old-invitation-token", "replacement-invitation-token"))
    monkeypatch.setattr(service, "_generate_token", lambda: next(tokens))
    monkeypatch.setattr(service.email_service, "send_invitation_email", lambda **_: None)

    old_invitation = service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=employee_email, role="cashier"),
    )
    replacement = service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=employee_email, role="manager"),
    )

    with pytest.raises(HTTPException) as exc:
        service.accept_invitation(
            db,
            body=InvitationAccept(token="old-invitation-token", password=None),
        )

    db.refresh(old_invitation)
    db.refresh(replacement)
    db.refresh(employee)
    assert exc.value.status_code == 400
    assert old_invitation.status == "revoked"
    assert replacement.status == "pending"
    assert employee.is_active is False
    assert employee.role == "cashier"


def test_accepted_invitation_cannot_be_reused(client, db, monkeypatch):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Reused Invitation")
    tenant_id = UUID(signup["tenant_id"])
    employee = _add_member(db, tenant_id=tenant_id, role="cashier")
    employee.is_active = False
    employee_email = auth_repo.get_user_by_id(db, employee.user_id).email
    db.commit()
    token = "single-use-invitation-token"
    monkeypatch.setattr(service, "_generate_token", lambda: token)
    monkeypatch.setattr(service.email_service, "send_invitation_email", lambda **_: None)
    invitation = service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=employee_email, role="manager"),
    )

    service.accept_invitation(db, body=InvitationAccept(token=token, password=None))
    with pytest.raises(HTTPException) as exc:
        service.accept_invitation(db, body=InvitationAccept(token=token, password=None))

    memberships = (
        db.query(Membership)
        .filter(Membership.tenant_id == tenant_id, Membership.user_id == employee.user_id)
        .all()
    )
    accepted_events = (
        db.query(AuditLog)
        .filter(
            AuditLog.resource_id == invitation.id,
            AuditLog.action == "employee.invitation_accepted",
        )
        .count()
    )
    assert exc.value.status_code == 400
    assert len(memberships) == 1
    assert memberships[0].is_active is True
    assert memberships[0].role == "manager"
    assert accepted_events == 1


def test_expired_invitation_does_not_reactivate_membership(client, db, monkeypatch):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Expired Invitation")
    tenant_id = UUID(signup["tenant_id"])
    employee = _add_member(db, tenant_id=tenant_id, role="cashier")
    employee.is_active = False
    employee_email = auth_repo.get_user_by_id(db, employee.user_id).email
    db.commit()
    token = "expired-invitation-token"
    monkeypatch.setattr(service, "_generate_token", lambda: token)
    monkeypatch.setattr(service.email_service, "send_invitation_email", lambda **_: None)
    invitation = service.invite_employee(
        db,
        tenant_id=tenant_id,
        user_id=UUID(signup["user_id"]),
        actor_role="owner",
        body=InvitationCreate(email=employee_email, role="manager"),
    )
    invitation.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        service.accept_invitation(db, body=InvitationAccept(token=token, password=None))

    db.refresh(employee)
    assert exc.value.status_code == 400
    assert invitation.status == "pending"
    assert employee.is_active is False
    assert employee.role == "cashier"


def test_concurrent_invitation_acceptance_reactivates_membership_once(
    owner_engine, monkeypatch
):
    seed = Session(owner_engine)
    token = f"concurrent-invitation-{uuid4().hex}"
    tenant = Tenant(name="Concurrent Invitation", slug=f"invitation-{uuid4().hex}")
    seed.add(tenant)
    seed.flush()
    owner = _add_member(seed, tenant_id=tenant.id, role="owner")
    employee = _add_member(seed, tenant_id=tenant.id, role="cashier")
    employee.is_active = False
    employee_email = auth_repo.get_user_by_id(seed, employee.user_id).email
    invitation = MembershipInvitation(
        tenant_id=tenant.id,
        email=employee_email,
        role="manager",
        status="pending",
        invited_by_user_id=owner.user_id,
        token_hash=service._hash_token(token),
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    seed.add(invitation)
    seed.commit()
    tenant_id = tenant.id
    invitation_id = invitation.id
    membership_id = employee.id
    user_ids = (owner.user_id, employee.user_id)
    seed.close()
    start_barrier = Barrier(2)
    lookup_barrier = Barrier(2)
    original_get_user_by_email = service.auth_repo.get_user_by_email

    def synchronized_get_user_by_email(db, email):
        # Without the invitation row lock both transactions reach this point
        # while the token is still pending, making the duplicate consumption
        # deterministic. With the lock, the winner times out and commits; the
        # waiter then sees the final invitation status before reaching here.
        try:
            lookup_barrier.wait(timeout=1)
        except BrokenBarrierError:
            pass
        return original_get_user_by_email(db, email)

    monkeypatch.setattr(
        service.auth_repo,
        "get_user_by_email",
        synchronized_get_user_by_email,
    )

    def accept() -> tuple[int, int]:
        session = Session(owner_engine)
        try:
            connection_id = session.execute(text("SELECT pg_backend_pid()")).scalar_one()
            start_barrier.wait(timeout=5)
            service.accept_invitation(
                session,
                body=InvitationAccept(token=token, password=None),
            )
            return 200, connection_id
        except HTTPException as exc:
            session.rollback()
            return exc.status_code, connection_id
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(accept)
        second = pool.submit(accept)
        outcomes = (first.result(timeout=10), second.result(timeout=10))
        results = sorted(status for status, _ in outcomes)
        connection_ids = {connection_id for _, connection_id in outcomes}

    verify = Session(owner_engine)
    try:
        memberships = (
            verify.query(Membership)
            .filter(Membership.tenant_id == tenant_id, Membership.id == membership_id)
            .all()
        )
        accepted_events = (
            verify.query(AuditLog)
            .filter(
                AuditLog.resource_id == invitation_id,
                AuditLog.action == "employee.invitation_accepted",
            )
            .count()
        )
        accepted_invitation = verify.get(MembershipInvitation, invitation_id)
        assert results == [200, 400]
        assert len(connection_ids) == 2
        assert len(memberships) == 1
        assert memberships[0].is_active is True
        assert memberships[0].role == "manager"
        assert accepted_invitation.status == "accepted"
        assert accepted_events == 1
    finally:
        verify.query(AuditLog).filter(AuditLog.tenant_id == tenant_id).delete()
        verify.query(MembershipInvitation).filter(
            MembershipInvitation.tenant_id == tenant_id
        ).delete()
        verify.query(Membership).filter(Membership.tenant_id == tenant_id).delete()
        verify.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
        verify.query(Tenant).filter(Tenant.id == tenant_id).delete()
        verify.commit()
        verify.close()


def test_revoke_pending_invitation(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Revoke")
    invitation = _invite(db, signup)
    assert invitation.status == "pending"

    service.revoke_invitation(
        db,
        tenant_id=UUID(signup["tenant_id"]),
        user_id=UUID(signup["user_id"]),
        invitation_id=invitation.id,
    )
    db.refresh(invitation)
    assert invitation.status == "revoked"
    assert invitation.revoked_at is not None


def test_revoke_invitation_is_tenant_scoped(client, db):
    """An invitation belonging to another tenant is 404, never revealed/mutated."""
    owner = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Revoke A")
    invitation = _invite(db, owner)
    other = _signup(client, f"other-{uuid4().hex}@example.com", "RBAC Revoke B")

    with pytest.raises(HTTPException) as exc:
        service.revoke_invitation(
            db,
            tenant_id=UUID(other["tenant_id"]),
            user_id=UUID(other["user_id"]),
            invitation_id=invitation.id,
        )
    assert exc.value.status_code == 404
    db.refresh(invitation)
    assert invitation.status == "pending"


def test_revoke_non_pending_invitation_rejected(client, db):
    signup = _signup(client, f"owner-{uuid4().hex}@example.com", "RBAC Revoke Twice")
    invitation = _invite(db, signup)
    service.revoke_invitation(
        db,
        tenant_id=UUID(signup["tenant_id"]),
        user_id=UUID(signup["user_id"]),
        invitation_id=invitation.id,
    )
    with pytest.raises(HTTPException) as exc:
        service.revoke_invitation(
            db,
            tenant_id=UUID(signup["tenant_id"]),
            user_id=UUID(signup["user_id"]),
            invitation_id=invitation.id,
        )
    assert exc.value.status_code == 400

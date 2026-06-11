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

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import repository as auth_repo
from app.auth import service as auth_service
from app.auth.models import Membership
from app.employees import service
from app.employees.schemas import EmployeeRoleUpdate, InvitationCreate


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

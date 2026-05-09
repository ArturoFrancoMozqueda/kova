from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import repository as auth_repo
from app.auth.models import Membership, User, UserSession
from app.auth.service import decode_access_token
from app.db import get_db
from app.observability.logging import set_request_context
from app.rbac.permissions import Permission, has_permission
from app.shared.exceptions import forbidden, unauthorized


def get_current_session(
    request: Request,
    db: Session = Depends(get_db),
) -> tuple[User, Membership, UserSession]:
    token = request.cookies.get("access_token")
    if not token:
        raise unauthorized()

    payload = decode_access_token(token)
    session_id = payload.get("jti")
    user_id = payload.get("sub")
    tenant_id = payload.get("tid")

    if not session_id or not user_id or not tenant_id:
        raise unauthorized()

    session = auth_repo.get_session_by_id(db, UUID(session_id))
    if not session or session.revoked_at:
        raise unauthorized("Session revoked")

    user = auth_repo.get_user_by_id(db, UUID(user_id))
    if not user or not user.is_active:
        raise unauthorized()

    membership = auth_repo.get_membership(db, user_id=user.id, tenant_id=UUID(tenant_id))
    if not membership:
        raise forbidden("No active membership for this tenant")

    set_request_context(tenant_id=membership.tenant_id, user_id=user.id)
    db.execute(
        text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
        {"tenant_id": str(membership.tenant_id)},
    )
    return user, membership, session


def require_permission(permission: Permission):
    def dependency(
        ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
    ) -> tuple[User, Membership, UserSession]:
        _, membership, _ = ctx
        if not has_permission(membership.role, permission):
            raise forbidden()
        return ctx

    return dependency

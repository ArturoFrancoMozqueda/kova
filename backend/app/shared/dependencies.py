from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import repository as auth_repo
from app.auth.models import Membership, User, UserSession
from app.auth.service import decode_access_token
from app.db import get_db, set_tenant_context
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

    # Browser cookies are shared between tabs, while a React tree can still be
    # showing the identity it loaded earlier. These headers are a fail-closed
    # precondition only: the signed cookie remains the sole authority. A stale
    # tab therefore cannot write under the newer cookie's tenant or user.
    expected_tenant = request.headers.get("X-Kova-Expected-Tenant")
    expected_user = request.headers.get("X-Kova-Expected-User")
    if (
        (expected_tenant and expected_tenant != tenant_id)
        or (expected_user and expected_user != user_id)
    ):
        raise HTTPException(
            status_code=409,
            detail="La sesión cambió. Verifica el negocio activo e inténtalo de nuevo.",
            headers={"X-Kova-Identity-Mismatch": "true"},
        )

    # Establish the RLS tenant context BEFORE any tenant-scoped read. The tenant
    # id comes from the signed access token, so it is trusted. The runtime app
    # role (`kova_app`) is subject to RLS, so the session/membership lookups below
    # (both tenant-scoped tables) would return nothing without this. Setting it
    # from the token also means a session/membership belonging to a different
    # tenant is invisible here — an extra integrity check, not just a convenience.
    # `set_config(..., true)` is transaction-local (pgBouncer-safe).
    set_tenant_context(db, tenant_id)

    session = auth_repo.get_session_by_id(db, UUID(session_id))
    if not session or session.revoked_at:
        raise unauthorized("Session revoked")

    user = auth_repo.get_user_by_id(db, UUID(user_id))
    if not user or not user.is_active:
        raise unauthorized()

    membership = auth_repo.get_membership(db, user_id=user.id, tenant_id=UUID(tenant_id))
    if not membership:
        raise forbidden("No active membership for this tenant")

    from app.branches.scope import bind_branch

    selected_branch = request.headers.get("X-Kova-Branch")
    try:
        branch_id = UUID(selected_branch) if selected_branch else None
    except ValueError:
        raise HTTPException(status_code=422, detail="Sucursal inválida") from None
    bind_branch(db, tenant_id=membership.tenant_id, branch_id=branch_id)
    # Fiscal periods consolidate the business, regardless of the active drawer.
    if request.url.path.startswith("/api/v1/fiscal/"):
        db.info.pop("kova_branch_id", None)
    set_request_context(tenant_id=membership.tenant_id, user_id=user.id)
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

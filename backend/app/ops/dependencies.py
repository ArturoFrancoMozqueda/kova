"""Auth for the internal ops dashboard.

``require_internal_admin`` intentionally does NOT reuse
``app.shared.dependencies.get_current_session``: that dependency binds the
request to one tenant by setting the ``app.tenant_id`` RLS GUC and by
requiring a membership. Ops endpoints aggregate across all tenants, so they
must run without the GUC (the app's DB role owns the tables and is therefore
exempt from RLS — same mechanism as ``GET /api/v1/billing/internal/subscriptions``)
and authorization comes from the ``INTERNAL_ADMIN_EMAILS`` allowlist, never
from tenant roles.
"""
import logging
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import repository as auth_repo
from app.auth.models import User, UserSession
from app.auth.service import decode_access_token
from app.config import settings
from app.db import get_db
from app.observability.logging import set_request_context
from app.shared.exceptions import forbidden, unauthorized

_access_logger = logging.getLogger("app.ops.access")

# Same detail for "not verified" and "not allowlisted" so a response can't be
# used to probe who is on the allowlist.
_FORBIDDEN_DETAIL = "Not an internal admin"


@dataclass(frozen=True)
class InternalAdminContext:
    user: User
    session: UserSession


def require_internal_admin(
    request: Request,
    db: Session = Depends(get_db),
) -> InternalAdminContext:
    token = request.cookies.get("access_token")
    if not token:
        raise unauthorized()

    payload = decode_access_token(token)
    session_id = payload.get("jti")
    user_id = payload.get("sub")
    if not session_id or not user_id:
        raise unauthorized()

    session = auth_repo.get_session_by_id(db, UUID(session_id))
    if not session or session.revoked_at:
        raise unauthorized("Session revoked")

    user = auth_repo.get_user_by_id(db, UUID(user_id))
    if not user or not user.is_active:
        raise unauthorized()

    if not user.is_email_verified:
        raise forbidden(_FORBIDDEN_DETAIL)
    if user.email.lower() not in settings.internal_admin_email_set:
        raise forbidden(_FORBIDDEN_DETAIL)

    # Clear the RLS GUC in case something set it earlier in this transaction;
    # '' never matches a tenant_id, and set_config(..., true) is
    # transaction-scoped so nothing leaks past this request either way.
    db.execute(text("SELECT set_config('app.tenant_id', '', true)"))
    set_request_context(user_id=user.id)
    _access_logger.info(
        "ops_access",
        extra={"method": request.method, "path": request.url.path},
    )
    return InternalAdminContext(user=user, session=session)

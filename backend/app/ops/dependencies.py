"""Auth for the internal ops dashboard.

``require_internal_admin`` intentionally does NOT reuse
``app.shared.dependencies.get_current_session``: that dependency binds the
request to one tenant. Ops endpoints aggregate across all tenants, so this
small, explicitly sanctioned module uses the privileged DB session. Access
requires the configured founder email and immutable user UUID; tenant roles
never grant Kova Ops access.
"""
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import repository as auth_repo
from app.auth.models import User, UserSession
from app.auth.service import decode_access_token
from app.config import settings
from app.db import get_privileged_db
from app.observability.logging import set_request_context
from app.ops import mfa
from app.shared.exceptions import forbidden, unauthorized

_access_logger = logging.getLogger("app.ops.access")

# Same detail for "not verified" and "not allowlisted" so a response can't be
# used to probe who is on the allowlist.
_FORBIDDEN_DETAIL = "Not an internal admin"


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass(frozen=True)
class InternalAdminContext:
    user: User
    session: UserSession


def require_internal_founder(
    request: Request,
    db: Session = Depends(get_privileged_db),
) -> InternalAdminContext:
    token = request.cookies.get("access_token")
    if not token:
        raise unauthorized()

    payload = decode_access_token(token)
    session_id = payload.get("jti")
    user_id = payload.get("sub")
    tenant_id = payload.get("tid")
    if not session_id or not user_id or not tenant_id:
        raise unauthorized()

    try:
        session_uuid = UUID(session_id)
        user_uuid = UUID(user_id)
        tenant_uuid = UUID(tenant_id)
    except (TypeError, ValueError):
        raise unauthorized() from None

    session = auth_repo.get_session_by_id(db, session_uuid)
    if (
        not session
        or session.revoked_at
        or _as_utc(session.expires_at) < datetime.now(UTC)
    ):
        raise unauthorized("Session revoked")

    user = auth_repo.get_user_by_id(db, user_uuid)
    if not user or not user.is_active:
        raise unauthorized()
    if session.user_id != user.id or session.tenant_id != tenant_uuid:
        raise unauthorized()

    if not user.is_email_verified:
        raise forbidden(_FORBIDDEN_DETAIL)
    if user.email.lower() not in settings.internal_admin_email_set:
        raise forbidden(_FORBIDDEN_DETAIL)
    if (
        settings.internal_admin_user_id is not None
        and user.id != settings.internal_admin_user_id
    ):
        raise forbidden(_FORBIDDEN_DETAIL)

    # Defensive reset for reused/test transactions. The privileged production
    # role bypasses RLS, but a stale tenant context must never shape ops data.
    db.execute(text("SELECT set_config('app.tenant_id', '', true)"))
    set_request_context(user_id=user.id)
    _access_logger.info(
        "ops_access",
        extra={"method": request.method, "path": request.url.path},
    )
    return InternalAdminContext(user=user, session=session)


def require_internal_admin(
    ctx: InternalAdminContext = Depends(require_internal_founder),
    db: Session = Depends(get_privileged_db),
) -> InternalAdminContext:
    """Require an enrolled factor and a recent server-side MFA step-up."""
    if not mfa.factor_exists(db, user_id=ctx.user.id) or not mfa.step_up_is_valid(
        ctx.session
    ):
        raise HTTPException(status_code=428, detail="MFA_REQUIRED")
    return ctx

"""Default commercial gate after session/tenant resolution, with explicit recovery routes."""

from fastapi import Request
from sqlalchemy.orm import Session

from app.rbac.permissions import has_permission
from app.shared.exceptions import forbidden

# Route templates (not a loose prefix) keep data rights and revocation available
# without opening another operational endpoint under the same module.
RECOVERY_ROUTES = frozenset({
    ("GET", "/api/v1/export/account"),
    ("GET", "/api/v1/account/deletion"),
    ("POST", "/api/v1/account/deletion"),
    ("DELETE", "/api/v1/account/deletion"),
    ("GET", "/api/v1/assistant/export"),
    ("GET", "/api/v1/assistant/preferences"),
    ("PUT", "/api/v1/assistant/preferences"),
    ("DELETE", "/api/v1/assistant/conversations/{identifier}"),
    ("DELETE", "/api/v1/assistant/memory/{identifier}"),
    ("DELETE", "/api/v1/assistant/goals/{identifier}"),
    ("DELETE", "/api/v1/assistant/documents/{identifier}"),
    ("DELETE", "/api/v1/hardware/drawer"),
    ("DELETE", "/api/v1/employees/invitations/{invitation_id}"),
    ("DELETE", "/api/v1/employees/{membership_id}"),
})


def commercial_recovery_route(method: str, path: str) -> bool:
    return (
        path.startswith("/api/v1/auth/")
        or path.startswith("/api/v1/billing/")
        # Platform operations keep their separate identity/MFA/step-up controls.
        or path.startswith("/api/v1/internal/ops/")
        or path == "/api/v1/internal/ops"
        or (method, path) in RECOVERY_ROUTES
    )


def enforce_session_commercial_policy(request: Request, db: Session, user, membership) -> None:
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    if commercial_recovery_route(request.method, path):
        return

    # Enforce each declared RBAC dependency before commercial access, even for
    # routes using the common session directly plus a permission factory.
    pending = [getattr(route, "dependant", None)]
    seen = set()
    while pending:
        dependant = pending.pop()
        if dependant is None or id(dependant) in seen:
            continue
        seen.add(id(dependant))
        permission = getattr(dependant.call, "commercial_policy_permission", None)
        if permission is not None and not has_permission(membership.role, permission):
            raise forbidden()
        pending.extend(dependant.dependencies)

    from app.billing.access import enforce_commercial_access

    enforce_commercial_access(db, request=request, user=user, membership=membership)

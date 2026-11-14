"""Guard: every state-changing route declares an RBAC permission.

A POST/PUT/PATCH/DELETE route passes when its dependency tree (direct or
transitive, including router-level dependencies) contains a dependency built by
``require_permission`` / ``require_commercial_access`` (or any factory that tags
its callable with ``commercial_policy_permission``). Everything else must be in
the allowlist below with the reason it is safe without a tenant permission.

The test is generic on purpose: new permissions or routes need no change here
as long as they use the shared permission factories.
"""

from fastapi.routing import iter_route_contexts

from app import main
from app.rbac.permissions import Permission

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

_AUTH = "auth flow: pre-session or acts only on the caller's own session/identity"
_PUBLIC = "public storefront/booking/loyalty: token-scoped, origin-checked, rate limited"
_INTERNAL = "internal job: X-Internal-Key, constant-time compared"
_OPS = "platform ops: internal admin/founder identity with MFA, not tenant RBAC"
_CONNECTOR = "hardware connector: authenticated by a paired device token"

ALLOWLIST: dict[tuple[str, str], str] = {
    ("POST", "/api/v1/auth/signup"): _AUTH,
    ("POST", "/api/v1/auth/verify"): _AUTH,
    ("POST", "/api/v1/auth/verify/resend"): _AUTH,
    ("POST", "/api/v1/auth/login"): _AUTH,
    ("POST", "/api/v1/auth/refresh"): _AUTH,
    ("POST", "/api/v1/auth/logout"): _AUTH,
    ("POST", "/api/v1/auth/logout-all"): _AUTH,
    ("POST", "/api/v1/auth/password-reset/request"): _AUTH,
    ("POST", "/api/v1/auth/password-reset/confirm"): _AUTH,
    ("POST", "/api/v1/employees/invitations/accept"): (
        "invitee has no session yet; authorized by the single-use invitation token"
    ),
    ("POST", "/api/v1/account/deletion"): (
        "owner-only data-rights route; `_owner_context` checks the permission inline"
    ),
    ("DELETE", "/api/v1/account/deletion"): (
        "owner-only data-rights route; `_owner_context` checks the permission inline"
    ),
    ("POST", "/api/v1/telemetry/events"): (
        "any signed-in member records allowlisted product events for its own tenant"
    ),
    ("POST", "/api/v1/telemetry/events/anonymous/session"): "anonymous landing telemetry",
    ("POST", "/api/v1/telemetry/events/anonymous"): "anonymous landing telemetry",
    ("POST", "/api/v1/billing/webhooks/stripe"): "Stripe webhook: signature-verified",
    ("POST", "/api/v1/messaging/webhooks/whatsapp"): "provider webhook: signature-verified",
    ("POST", "/api/v1/billing/internal/reconcile"): _INTERNAL,
    ("POST", "/api/v1/account/internal/deletions/purge"): _INTERNAL,
    ("POST", "/api/v1/fiscal/internal/global-drafts/auto-close"): _INTERNAL,
    ("PATCH", "/api/v1/internal/ops/incidents/{incident_key:path}/triage"): _OPS,
    ("POST", "/api/v1/internal/ops/notes"): _OPS,
    ("PATCH", "/api/v1/internal/ops/notes/{note_id}"): _OPS,
    ("POST", "/api/v1/internal/ops/mfa/setup"): _OPS,
    ("POST", "/api/v1/internal/ops/mfa/confirm"): _OPS,
    ("POST", "/api/v1/internal/ops/mfa/verify"): _OPS,
    ("POST", "/api/v1/hardware/connector/pair"): _CONNECTOR,
    ("POST", "/api/v1/hardware/connector/poll"): _CONNECTOR,
    ("POST", "/api/v1/hardware/connector/commands/{command_id}/ack"): _CONNECTOR,
    ("POST", "/api/v1/public/bookings"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/manage/read"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/manage/slots"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/manage"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/table-requests"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/table-manage/read"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/table-manage/arrivals"): _PUBLIC,
    ("POST", "/api/v1/public/bookings/table-manage"): _PUBLIC,
    ("POST", "/api/v1/public/loyalty/membership/booking-grant"): _PUBLIC,
    ("POST", "/api/v1/public/loyalty/membership/enroll"): _PUBLIC,
    ("POST", "/api/v1/public/loyalty/cards"): _PUBLIC,
    ("POST", "/api/v1/public/catalog/{token}/requests"): _PUBLIC,
    ("POST", "/api/v1/public/order-tracking"): _PUBLIC,
}


def _declared_permissions(dependant) -> set:
    pending, seen, found = [dependant], set(), set()
    while pending:
        node = pending.pop()
        if node is None or id(node) in seen:
            continue
        seen.add(id(node))
        permission = getattr(node.call, "commercial_policy_permission", None)
        if permission is not None:
            found.add(permission)
        pending.extend(node.dependencies)
    return found


def _write_routes():
    app = main._construct_app()
    for route in iter_route_contexts(app.routes):
        dependant = getattr(route.route, "dependant", None)
        if dependant is None:
            continue
        for method in sorted((route.methods or set()) & WRITE_METHODS):
            yield method, route.path, dependant


def test_every_write_route_declares_a_permission_or_is_allowlisted():
    routes = list(_write_routes())
    assert len(routes) > 100, "route enumeration found suspiciously few write routes"

    missing, invalid = [], []
    for method, path, dependant in routes:
        permissions = _declared_permissions(dependant)
        if not permissions:
            if (method, path) not in ALLOWLIST:
                missing.append(f"{method} {path}")
        elif not all(isinstance(p, Permission) for p in permissions):
            invalid.append(f"{method} {path}: {permissions}")

    assert not missing, (
        "write routes without require_permission/require_commercial_access; add the "
        "permission or an allowlist entry with a reason:\n" + "\n".join(missing)
    )
    assert not invalid, "permission dependencies must use Permission members:\n" + "\n".join(
        invalid
    )


def test_allowlist_has_no_stale_or_redundant_entries():
    routes = {(method, path): dependant for method, path, dependant in _write_routes()}
    stale = sorted(f"{m} {p}" for m, p in ALLOWLIST if (m, p) not in routes)
    redundant = sorted(
        f"{m} {p}" for (m, p) in ALLOWLIST if (m, p) in routes and _declared_permissions(routes[m, p])
    )
    assert not stale, f"allowlisted routes no longer exist: {stale}"
    assert not redundant, f"allowlisted routes now declare a permission; drop them: {redundant}"
    assert all(reason.strip() for reason in ALLOWLIST.values())

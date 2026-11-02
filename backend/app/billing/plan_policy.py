"""Plan boundaries after session/RBAC and commercial access; never a payment bypass."""

from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.billing.plans import build_plan_snapshot, plan_has_feature


def require_plan_feature(db: Session, *, tenant_id: UUID, feature: str) -> None:
    if plan_has_feature(db, tenant_id=tenant_id, feature=feature):
        return
    raise HTTPException(status_code=403, detail={
        "message": "Esta función requiere el plan Gestión. Conservas tu información anterior.",
        "reason": "plan_feature_required", "feature": feature,
        "recovery_path": "/settings/billing",
    })


def route_feature(method: str, path: str) -> str | None:
    """Route templates, not client-supplied module names. Existing commitments stay operable."""
    if path in {
        "/api/v1/reports/business-story", "/api/v1/reports/sales-by-hour",
        "/api/v1/reports/sales-by-employee", "/api/v1/reports/refunds-by-reason",
        "/api/v1/reports/branches", "/api/v1/replenishment",
        "/api/v1/inventory/velocity",
    }:
        return "advanced_reports"
    if path == "/api/v1/replenishment/approve-purchase":
        return "purchasing"
    if method not in {"GET", "HEAD", "OPTIONS"}:
        if path in {"/api/v1/purchasing/orders", "/api/v1/purchasing/suppliers"}:
            return "purchasing"
        if path == "/api/v1/customer-orders" or (
            method == "PATCH" and path == "/api/v1/customer-orders/{order_id}"
        ):
            return "customer_orders"
        if path == "/api/v1/quotes":
            return "quotes"
        if path in {
            "/api/v1/crm/opportunities", "/api/v1/crm/followups",
            "/api/v1/crm/followups/policy", "/api/v1/crm/followups/process",
            "/api/v1/automations/process", "/api/v1/automations/rules/{template_key}",
        }:
            return "customer_orders"
        if path in {
            "/api/v1/loyalty/policy", "/api/v1/loyalty/rewards",
            "/api/v1/loyalty/enrollment-policy",
            "/api/v1/loyalty/customers/{customer_id}/digital-card",
        }:
            return "loyalty"
        if method == "POST" and path == "/api/v1/expenses":
            return "advanced_reports"
    return None


def enforce_session_plan_policy(request: Request, db: Session, membership) -> None:
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    feature = route_feature(request.method, path)
    if feature:
        require_plan_feature(db, tenant_id=membership.tenant_id, feature=feature)


def enforce_branch_creation_limit(db: Session, *, tenant_id: UUID) -> None:
    """Use at the shared write boundary so HTTP and assistant actions obey the cap."""
    snapshot = build_plan_snapshot(db, tenant_id=tenant_id)
    if snapshot["plan_code"] == "unknown":
        require_plan_feature(db, tenant_id=tenant_id, feature="pos")
    limit = snapshot["limits"]["branches"]
    if limit is None:
        return
    from app.branches.models import Branch
    from app.tenants.repository import lock_by_id

    lock_by_id(db, tenant_id)
    count = db.query(func.count(Branch.id)).filter(Branch.tenant_id == tenant_id).scalar()
    if count >= limit:
        raise HTTPException(403, detail={
            "message": ("Tu plan incluye una sucursal. "
                        "Contacta a soporte para ampliar tu operación."),
            "reason": "plan_limit_reached", "limit": "branches",
        })


def enforce_product_image_quota(
    db: Session, *, tenant_id: UUID, product_id: UUID, incoming_bytes: int,
) -> None:
    """Bound original product photos; derived thumbnail caches are platform overhead.

    Serialize uploads for the entire tenant, across branches. Shrinking an existing
    image remains possible after a downgrade even when stored data exceeds its cap.
    """
    from app.catalog.models import ProductImageFile

    snapshot = build_plan_snapshot(db, tenant_id=tenant_id)
    if snapshot["plan_code"] == "unknown":
        require_plan_feature(db, tenant_id=tenant_id, feature="inventory")
    limit = snapshot["limits"]["product_image_bytes"]
    if limit is None:
        return
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
               {"key": f"product-image-quota:{tenant_id}"})
    used = db.query(func.coalesce(func.sum(ProductImageFile.byte_size), 0)).filter(
        ProductImageFile.tenant_id == tenant_id,
    ).scalar()
    old = db.query(ProductImageFile.byte_size).filter(
        ProductImageFile.tenant_id == tenant_id, ProductImageFile.product_id == product_id,
    ).scalar() or 0
    if used - old + incoming_bytes > limit and incoming_bytes > old:
        raise HTTPException(403, detail={
            "message": ("Alcanzaste la capacidad de imágenes de tu plan. "
                        "Puedes eliminar o reducir imágenes; tus ventas siguen disponibles."),
            "reason": "plan_limit_reached", "limit": "product_image_bytes",
            "recovery_path": "/settings/billing",
        })

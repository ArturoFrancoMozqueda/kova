"""Anonymous projection of a single structured request and its explicitly linked order."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt

from app.billing.access import get_billing_access_status
from app.branches.models import Branch
from app.branches.scope import bind_branch
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.crm.engagement_models import CatalogRequest
from app.crm.engagement_schemas import PublicOrderTracking
from app.customer_orders.models import CustomerOrder, CustomerOrderItem
from app.customers.models import Customer
from app.db import set_tenant_context
from app.shared.exceptions import not_found
from app.storefront.models import PublicCatalog
from app.tenants.feature_flags import CUSTOMER_ORDERS, resolve_feature_flags
from app.tenants.models import Tenant

AUDIENCE = "kova-order-tracking"
TTL = timedelta(days=30)
UNAVAILABLE = "Seguimiento no disponible"


def _utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def receipt(db, row):
    result = {"receipt_id": str(row.id), "status": "received"}
    if row.order_lines is None:
        return result
    tenant = db.query(Tenant).filter_by(id=row.tenant_id).first()
    if tenant is None or not resolve_feature_flags(tenant.feature_overrides)[CUSTOMER_ORDERS]:
        # The same storefront can still capture a manual consultation when
        # operational orders are unavailable; never issue a link born blocked.
        return result
    # Stable across retries and later operator work; the receipt never reflects
    # current private status, identity, assignment or notes.
    issued = int(_utc(row.created_at).timestamp())
    expires = issued + int(TTL.total_seconds())
    token = jwt.encode({
        "aud": AUDIENCE, "tenant": str(row.tenant_id), "branch": str(row.branch_id),
        "request": str(row.id), "submission": str(row.submission_id),
        "iat": issued, "exp": expires,
    }, settings.secret_key, algorithm="HS256")
    result.update(
        tracking_path=f"/seguimiento#{token}",
        tracking_expires_at=datetime.fromtimestamp(expires, UTC).isoformat(),
    )
    return result


def _decode(token):
    try:
        if len(token) > 2000:
            raise ValueError
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"], audience=AUDIENCE,
            options={"require": ["aud", "tenant", "branch", "request", "submission", "iat", "exp"]})
        if payload["aud"] != AUDIENCE or type(payload["iat"]) is not int or (
            type(payload["exp"]) is not int
        ) or not 0 < payload["exp"] - payload["iat"] <= int(TTL.total_seconds()):
            raise ValueError
        for field in ("tenant", "branch", "request", "submission"):
            payload[field] = UUID(payload[field])
        return payload
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError, AttributeError):
        raise not_found(UNAVAILABLE) from None


def read(db, token):
    payload = _decode(token)
    tenant_id, branch_id = payload["tenant"], payload["branch"]
    set_tenant_context(db, tenant_id)
    tenant = db.query(Tenant).filter_by(id=tenant_id, is_active=True).first()
    branch = db.query(Branch).filter_by(tenant_id=tenant_id, id=branch_id).first()
    if tenant is None or branch is None or not get_billing_access_status(
        db, tenant_id=tenant_id,
    ).allowed or not resolve_feature_flags(tenant.feature_overrides)[CUSTOMER_ORDERS]:
        raise not_found(UNAVAILABLE)
    bind_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    request = db.query(CatalogRequest).filter_by(
        tenant_id=tenant_id, branch_id=branch_id, id=payload["request"],
        submission_id=payload["submission"],
    ).first()
    if request is None or request.order_lines is None:
        raise not_found(UNAVAILABLE)
    status = "dismissed" if request.status == "dismissed" else "pending_review"
    folio, total = None, None
    updated_at = request.resolved_at or request.created_at
    items = [{"product_name": item["product_name"], "quantity": item["quantity"]}
             for item in request.order_lines]
    if request.customer_order_id is not None:
        customer = db.query(Customer.id).filter_by(
            tenant_id=tenant_id, id=request.customer_id, is_active=True,
        ).first()
        order = db.query(CustomerOrder).filter_by(
            tenant_id=tenant_id, branch_id=branch_id, id=request.customer_order_id,
            customer_id=request.customer_id,
        ).first()
        if customer is None or order is None:
            raise not_found(UNAVAILABLE)
        status = "accepted" if order.status == "new" else order.status
        folio, total, updated_at = order.folio, order.total_amount, order.updated_at
        items = [{"product_name": item.product_name, "quantity": item.quantity} for item in
                 db.query(CustomerOrderItem).filter_by(
                     tenant_id=tenant_id, customer_order_id=order.id,
                 ).order_by(CustomerOrderItem.id).all()]
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant_id).first()
    catalog = db.query(PublicCatalog).filter_by(
        tenant_id=tenant_id, branch_id=branch_id, enabled=True,
    ).first()
    catalog_path = None
    if catalog is not None:
        from app.storefront.router import _settings

        catalog_path = _settings(db, catalog).share_path
    return PublicOrderTracking(
        business_name=profile.public_name if profile else tenant.name, branch_name=branch.name,
        status=status, folio=folio, total_amount=total, items=items, catalog_path=catalog_path,
        updated_at=updated_at, expires_at=datetime.fromtimestamp(payload["exp"], UTC),
    )

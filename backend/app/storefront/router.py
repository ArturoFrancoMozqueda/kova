import hashlib
import io
import sys
from datetime import UTC, datetime
from uuid import UUID

import jwt
import qrcode
from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.billing.access import get_billing_access_status, require_commercial_access
from app.branches.scope import active_branch_id, bind_branch
from app.catalog.models import Product
from app.config import settings
from app.customer_orders.models import InventoryReservation
from app.db import get_db, set_tenant_context
from app.idempotency import service as idempotency
from app.inventory.repository import stock_on_hand_for_products
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, conflict, not_found
from app.storefront.models import PublicCatalog, PublicCatalogItem
from app.storefront.schemas import (
    CatalogSettings,
    CatalogWrite,
    PublicCatalogResponse,
    PublicProduct,
)

router = APIRouter(tags=["storefront"])


def _catalog(db, tenant_id, *, lock=False):
    query = db.query(PublicCatalog).filter(
        PublicCatalog.tenant_id == tenant_id,
        PublicCatalog.branch_id == active_branch_id(db, tenant_id),
    )
    return (query.with_for_update() if lock else query).first()


def _settings(db, row):
    if row is None:
        return CatalogSettings(
            enabled=False,
            title="Mi catálogo",
            description=None,
            whatsapp_phone=None,
            product_ids=[],
            version=0,
            share_path=None,
        )
    token = jwt.encode(
        {
            "aud": "kova-public-catalog",
            "tenant": str(row.tenant_id),
            "branch": str(row.branch_id),
            "catalog": str(row.id),
            "version": row.link_version,
        },
        settings.secret_key,
        algorithm="HS256",
    )
    ids = [
        item.product_id
        for item in db.query(PublicCatalogItem)
        .filter_by(tenant_id=row.tenant_id, catalog_id=row.id)
        .order_by(PublicCatalogItem.product_id)
        .all()
    ]
    return CatalogSettings(
        enabled=row.enabled,
        title=row.title,
        description=row.description,
        whatsapp_phone=row.whatsapp_phone,
        product_ids=ids,
        version=row.version,
        share_path=f"/catalogo/{token}" if row.enabled else None,
    )


@router.get("/api/v1/storefront/settings", response_model=CatalogSettings)
def get_settings(
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE)),
):
    return _settings(db, _catalog(db, ctx[1].tenant_id))


@router.put("/api/v1/storefront/settings", response_model=CatalogSettings)
def save_settings(
    body: CatalogWrite,
    response: Response,
    db: Session = Depends(get_db),
    key: str | None = Header(default=None, alias="Idempotency-Key"),
    ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE)),
):
    user, membership, _ = ctx
    tenant_id = membership.tenant_id
    if not key or len(key) > 200:
        raise bad_request("Idempotency-Key es obligatorio y debe tener hasta 200 caracteres")
    fingerprint = hashlib.sha256(f"storefront:{body.model_dump_json()}".encode()).hexdigest()
    replay = idempotency.claim(db, tenant_id=tenant_id, key=key, request_hash=fingerprint)
    if replay:
        response.status_code = replay.response_status
        return replay.response_body
    # Serialize first publication as well as updates using an existing branch row.
    from app.branches.models import Branch

    branch_id = active_branch_id(db, tenant_id)
    db.query(Branch).filter_by(tenant_id=tenant_id, id=branch_id).with_for_update().one()
    row = _catalog(db, tenant_id, lock=True)
    if body.expected_version != (row.version if row else 0):
        raise conflict("El catálogo cambió. Actualiza antes de guardar.")
    products = (
        db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.id.in_(body.product_ids),
            Product.is_active.is_(True),
        )
        .all()
    )
    if len(products) != len(body.product_ids):
        raise bad_request("Selecciona sólo productos activos de este negocio")
    if body.enabled and not body.product_ids:
        raise bad_request("Selecciona al menos un producto para publicar")
    if row is None:
        row = PublicCatalog(tenant_id=tenant_id, branch_id=branch_id, version=0, link_version=1)
        db.add(row)
    for field in ("title", "description", "whatsapp_phone", "enabled"):
        setattr(row, field, getattr(body, field))
    if body.rotate_link:
        row.link_version += 1
    row.version += 1
    row.updated_at = datetime.now(UTC)
    db.flush()
    db.query(PublicCatalogItem).filter_by(tenant_id=tenant_id, catalog_id=row.id).delete()
    for product_id in body.product_ids:
        db.add(PublicCatalogItem(tenant_id=tenant_id, catalog_id=row.id, product_id=product_id))
    db.flush()
    result = _settings(db, row).model_dump(mode="json")
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="storefront.update",
        resource_type="public_catalog",
        resource_id=row.id,
        changes={
            "enabled": row.enabled,
            "version": row.version,
            "product_count": len(body.product_ids),
            "link_rotated": body.rotate_link,
        },
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=fingerprint,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return result


@router.get(
    "/api/v1/public/catalog/{token}",
    response_model=PublicCatalogResponse,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="public-catalog"))],
)
def read_public_catalog(token: str, db: Session = Depends(get_db)):
    row = resolve_public_catalog(db, token)
    tenant_id = row.tenant_id
    products = (
        db.query(Product)
        .join(
            PublicCatalogItem,
            (PublicCatalogItem.product_id == Product.id)
            & (PublicCatalogItem.tenant_id == Product.tenant_id),
        )
        .filter(
            PublicCatalogItem.catalog_id == row.id,
            Product.tenant_id == tenant_id,
            Product.is_active.is_(True),
        )
        .order_by(Product.name, Product.id)
        .limit(200)
        .all()
    )
    ids = [product.id for product in products]
    stock = stock_on_hand_for_products(db, tenant_id=tenant_id, product_ids=ids)
    reserved = (
        dict(
            db.query(InventoryReservation.product_id, func.sum(InventoryReservation.quantity))
            .filter(
                InventoryReservation.tenant_id == tenant_id,
                InventoryReservation.product_id.in_(ids),
                InventoryReservation.status == "active",
            )
            .group_by(InventoryReservation.product_id)
            .all()
        )
        if ids
        else {}
    )
    return PublicCatalogResponse(
        title=row.title,
        description=row.description,
        whatsapp_phone=row.whatsapp_phone,
        products=[
            PublicProduct(
                id=p.id,
                name=p.name,
                description=p.description,
                price_amount=p.price_amount,
                image_url=p.image_url,
                image_position_x=p.image_position_x,
                image_position_y=p.image_position_y,
                image_zoom=p.image_zoom,
                availability=(
                    "available"
                    if not p.track_inventory or stock.get(p.id, 0) - reserved.get(p.id, 0) > 0
                    else "unavailable"
                ),
            )
            for p in products
        ],
    )


@router.get("/api/v1/storefront/qr")
def catalog_qr(
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.SETTINGS_MANAGE)),
):
    current = _settings(db, _catalog(db, ctx[1].tenant_id))
    if not current.share_path:
        raise not_found("Publica el catálogo antes de generar su código QR")
    # Only the deployment's configured origin can be encoded, never a browser URL.
    qr = qrcode.QRCode()
    qr.add_data(settings.frontend_url.rstrip("/") + current.share_path)
    qr.make(fit=True)
    if sys.platform == "emscripten":
        from qrcode.image.pure import PyPNGImage

        image = qr.make_image(image_factory=PyPNGImage)
    else:
        image = qr.make_image()
    output = io.BytesIO()
    image.save(output)
    return Response(
        content=output.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store"},
    )


def resolve_public_catalog(db, token):
    try:
        if len(token) > 1500:
            raise ValueError
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience="kova-public-catalog",
            options={"require": ["tenant", "branch", "catalog", "version", "aud"]},
        )
        tenant_id, branch_id, catalog_id = (
            UUID(payload[field]) for field in ("tenant", "branch", "catalog")
        )
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise not_found("Catálogo no disponible") from None
    # A signed, narrowly scoped publication capability authorizes ONLY this projection.
    # No owner connection and no session or generic tenant-resource access is granted.
    set_tenant_context(db, tenant_id)
    row = (
        db.query(PublicCatalog)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=branch_id,
            id=catalog_id,
            enabled=True,
            link_version=payload["version"],
        )
        .first()
    )
    from app.tenants.models import Tenant

    active_tenant = db.query(Tenant.id).filter_by(id=tenant_id, is_active=True).first()
    if (
        row is None
        or active_tenant is None
        or not get_billing_access_status(db, tenant_id=tenant_id).allowed
    ):
        raise not_found("Catálogo no disponible")
    bind_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    return row


from fastapi import Request  # noqa: E402

from app.crm import engagement  # noqa: E402
from app.crm.engagement_schemas import PublicRequestReceipt, PublicRequestWrite  # noqa: E402
from app.shared.exceptions import forbidden  # noqa: E402
from app.shared.origin import request_origin, trusted_origins  # noqa: E402


@router.post(
    "/api/v1/public/catalog/{token}/requests",
    response_model=PublicRequestReceipt,
    status_code=201,
    dependencies=[Depends(rate_limit(10, window_seconds=60, key="public-catalog-request"))],
)
def submit_catalog_request(
    token: str, body: PublicRequestWrite, request: Request, db: Session = Depends(get_db)
):
    # Public writes fail closed on missing/misconfigured origin. Session cookies grant nothing.
    allowed = trusted_origins()
    if not allowed or request_origin(request) not in allowed:
        raise forbidden("Request origin is not allowed")
    row = resolve_public_catalog(db, token)
    return engagement.capture_request(db, row, body)

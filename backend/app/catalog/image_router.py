import io
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.catalog.models import Product, ProductImageFile
from app.db import get_db, get_privileged_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request, not_found
from app.shared.validation import verify_image_signature

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 1024 * 1024  # 1 MB
ALLOWED_RESIZE_WIDTHS = {160, 320, 400, 800}


def _resize_to_width(data: bytes, content_type: str, target_width: int) -> tuple[bytes, str]:
    """Resize image to target_width preserving aspect ratio, output as WebP.
    Returns original bytes if image is already smaller, or on any error."""
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.width <= target_width:
                return data, content_type
            ratio = target_width / img.width
            target_height = max(1, int(img.height * ratio))
            # WebP supports alpha — preserve transparency for PNG/RGBA/LA/P sources
            # so transparent product photos don't get a black fill.
            if img.mode in ("RGBA", "LA", "P"):
                mode = "RGBA"
            elif img.mode == "RGB":
                mode = "RGB"
            else:
                mode = "RGBA" if "A" in img.mode else "RGB"
            resized = img.convert(mode).resize(
                (target_width, target_height), Image.Resampling.LANCZOS
            )
            buf = io.BytesIO()
            resized.save(buf, format="WEBP", quality=82, method=4)
            return buf.getvalue(), "image/webp"
    except Exception:
        return data, content_type


class ProductImageUploadResponse(BaseModel):
    image_url: str


@dataclass(frozen=True)
class ParsedMultipartFile:
    content_type: str
    data: bytes


def _parse_content_type_header(header_value: str) -> tuple[str, dict[str, str]]:
    parts = [part.strip() for part in header_value.split(";")]
    media_type = parts[0].lower()
    params: dict[str, str] = {}
    for part in parts[1:]:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        params[key.lower().strip()] = value.strip().strip('"')
    return media_type, params


async def _parse_image_upload(request: Request) -> ParsedMultipartFile:
    media_type, params = _parse_content_type_header(request.headers.get("content-type", ""))
    boundary = params.get("boundary")
    if media_type != "multipart/form-data" or not boundary:
        raise bad_request("Image upload must be multipart/form-data.")

    body = await request.body()
    if len(body) > MAX_IMAGE_BYTES + 16_384:
        raise bad_request("Image must be 1 MB or smaller.")

    delimiter = b"--" + boundary.encode()
    for raw_part in body.split(delimiter):
        part = raw_part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        header_blob, separator, data = part.partition(b"\r\n\r\n")
        if not separator:
            continue
        headers: dict[str, str] = {}
        for line in header_blob.decode("latin-1").split("\r\n"):
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.lower().strip()] = value.strip()
        disposition = headers.get("content-disposition", "")
        _, disposition_params = _parse_content_type_header(disposition)
        if disposition_params.get("name") not in {"file", "image"}:
            continue
        content_type = headers.get("content-type", "").lower()
        return ParsedMultipartFile(content_type=content_type, data=data.rstrip(b"\r\n"))

    raise bad_request("Image file is required.")


def _image_url(product_id: UUID, updated_at: datetime) -> str:
    epoch = int(updated_at.timestamp())
    return f"/api/v1/catalog/products/{product_id}/image?v={epoch}"


def _load_product(db: Session, *, tenant_id: UUID, product_id: UUID) -> Product:
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.tenant_id == tenant_id)
        .one_or_none()
    )
    if product is None:
        raise not_found("Product not found")
    return product


@router.post(
    "/products/{product_id}/image",
    response_model=ProductImageUploadResponse,
    dependencies=[Depends(rate_limit(30, key="catalog-image-upload"))],
)
async def upload_product_image(
    product_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    product = _load_product(db, tenant_id=membership.tenant_id, product_id=product_id)

    parsed = await _parse_image_upload(request)
    if parsed.content_type not in ALLOWED_CONTENT_TYPES:
        raise bad_request("Image must be PNG, JPEG, or WebP.")
    if len(parsed.data) > MAX_IMAGE_BYTES:
        raise bad_request("Image must be 1 MB or smaller.")
    verify_image_signature(parsed.content_type, parsed.data)

    now = datetime.now(UTC)
    image = (
        db.query(ProductImageFile)
        .filter(ProductImageFile.product_id == product_id)
        .one_or_none()
    )
    if image is None:
        image = ProductImageFile(
            tenant_id=membership.tenant_id,
            product_id=product_id,
            created_at=now,
        )
        db.add(image)

    image.content_type = parsed.content_type
    image.bytes_data = parsed.data
    image.byte_size = len(parsed.data)
    image.updated_at = now

    product.image_url = _image_url(product_id, now)
    product.updated_at = now

    audit_service.log(
        db,
        action="catalog.product.image.upload",
        tenant_id=membership.tenant_id,
        user_id=user.id,
        resource_type="product",
        resource_id=product_id,
        changes={"content_type": image.content_type, "byte_size": image.byte_size},
    )
    db.commit()
    return ProductImageUploadResponse(image_url=product.image_url)


@router.delete(
    "/products/{product_id}/image",
    status_code=204,
    dependencies=[Depends(rate_limit(30, key="catalog-image-delete"))],
)
def delete_product_image(
    product_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_permission(Permission.CATALOG_UPDATE)
    ),
):
    user, membership, _ = ctx
    product = _load_product(db, tenant_id=membership.tenant_id, product_id=product_id)
    image = (
        db.query(ProductImageFile)
        .filter(ProductImageFile.product_id == product_id)
        .one_or_none()
    )
    if image is not None:
        db.delete(image)
    product.image_url = None
    product.updated_at = datetime.now(UTC)

    audit_service.log(
        db,
        action="catalog.product.image.delete",
        tenant_id=membership.tenant_id,
        user_id=user.id,
        resource_type="product",
        resource_id=product_id,
    )
    db.commit()
    return Response(status_code=204)


@router.get(
    "/products/{product_id}/image",
    dependencies=[Depends(rate_limit(120, key="product-image-get"))],
)
def get_product_image(
    product_id: UUID,
    # Public, unauthenticated read served cross-tenant by product id (no tenant
    # context). Privileged engine (RLS bypass); the query is scoped by id only.
    db: Session = Depends(get_privileged_db),
    w: int | None = Query(default=None, description="Optional resize width (160, 320, 400, 800)"),
):
    image_row = (
        db.execute(
            select(ProductImageFile.bytes_data, ProductImageFile.content_type)
            .join(Product, Product.id == ProductImageFile.product_id)
            .where(
                ProductImageFile.product_id == product_id,
                ProductImageFile.tenant_id == Product.tenant_id,
                Product.is_active.is_(True),
            )
        )
        .one_or_none()
    )
    if image_row is None:
        raise not_found("Product image not found")

    body, media_type = image_row
    db.close()
    if w is not None and w in ALLOWED_RESIZE_WIDTHS:
        body, media_type = _resize_to_width(body, media_type, w)

    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )

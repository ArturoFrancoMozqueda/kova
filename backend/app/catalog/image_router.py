from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.catalog.models import Product, ProductImageFile
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request, not_found

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 1024 * 1024  # 1 MB


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


@router.post("/products/{product_id}/image", response_model=ProductImageUploadResponse)
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


@router.delete("/products/{product_id}/image", status_code=204)
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


@router.get("/products/{product_id}/image")
def get_product_image(product_id: UUID, db: Session = Depends(get_db)):
    image = (
        db.query(ProductImageFile)
        .filter(ProductImageFile.product_id == product_id)
        .one_or_none()
    )
    if image is None:
        raise not_found("Product image not found")
    return Response(
        content=image.bytes_data,
        media_type=image.content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )

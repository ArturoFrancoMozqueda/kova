import hashlib
import io
import sys
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import BoundedSemaphore, Lock
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

if sys.platform != "emscripten":
    from PIL import Image, ImageOps
    from PIL import WebPImagePlugin  # noqa: F401 -- register encoder before serving the first photo

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.catalog.models import Product, ProductImageFile
from app.db import get_db, get_privileged_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.dependencies import require_permission
from app.shared.exceptions import bad_request, not_found
from app.shared.validation import verify_image_signature

if sys.platform != "emscripten":
    # OpenAPI prepares native routers before the listener opens. Prepare the
    # common decoders here too; no customer pays the first WebP/plugin import
    # cost when entering Caja on a new deployment.
    Image.preinit()

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_IMAGE_BYTES = 1024 * 1024  # 1 MB
ALLOWED_RESIZE_WIDTHS = {160, 320, 400, 800}
_RESIZE_CACHE_BYTES = 4 * 1024 * 1024
_MAX_DECODED_PIXELS = 8_000_000
_resized_images: OrderedDict[tuple[bytes, str, int], tuple[bytes, str]] = OrderedDict()
_resized_image_bytes = 0
_image_cache_lock = Lock()
_image_resize_lock = Lock()
_image_load_slots = BoundedSemaphore(4)


def _resize_to_width(data: bytes, content_type: str, target_width: int) -> tuple[bytes, str]:
    """Resize image to target_width preserving aspect ratio, output as WebP.
    Returns original bytes if image is already smaller, or on any error."""
    # Preserve the existing original-file fallback in Workers. Its WebAssembly
    # image catalog predates the application's decoder security floor.
    if sys.platform == "emscripten":
        return data, content_type
    # Product photos are already public. Cache only bounded derived bytes,
    # keyed by their actual contents so replacement/deletion never bypasses
    # the route's fresh product/activity/ownership query.
    key = (hashlib.sha256(data).digest(), content_type, target_width)
    with _image_cache_lock:
        cached = _resized_images.get(key)
        if cached is not None:
            _resized_images.move_to_end(key)
            return cached
    # Bound decoder memory and coalesce concurrent misses. Cache hits do not
    # wait behind an unrelated decode on the small resident instance.
    with _image_resize_lock:
        with _image_cache_lock:
            cached = _resized_images.get(key)
            if cached is not None:
                _resized_images.move_to_end(key)
                return cached
        result = _render_thumbnail(data, content_type, target_width)
        if result[0] is data or len(result[0]) > _RESIZE_CACHE_BYTES:
            return result
        global _resized_image_bytes
        with _image_cache_lock:
            while _resized_images and _resized_image_bytes + len(result[0]) > _RESIZE_CACHE_BYTES:
                _, evicted = _resized_images.popitem(last=False)
                _resized_image_bytes -= len(evicted[0])
            _resized_images[key] = result
            _resized_image_bytes += len(result[0])
        return result


def _render_thumbnail(data: bytes, content_type: str, target_width: int) -> tuple[bytes, str]:
    try:
        with Image.open(io.BytesIO(data)) as img:
            rotated = img.getexif().get(274, 1) in {5, 6, 7, 8}
            visual_width, visual_height = (img.height, img.width) if rotated else img.size
            if visual_width <= target_width:
                return data, content_type
            ratio = target_width / visual_width
            target_height = max(1, int(visual_height * ratio))
            # WebP supports alpha — preserve transparency for PNG/RGBA/LA/P sources
            # so transparent product photos don't get a black fill.
            if img.mode in ("RGBA", "LA", "P"):
                mode = "RGBA"
            elif img.mode == "RGB":
                mode = "RGB"
            else:
                mode = "RGBA" if "A" in img.mode else "RGB"
            # JPEG draft decodes at a reduced DCT scale before allocating a
            # full phone-sized bitmap. Other formats keep their decoder path.
            draft_size = (target_height, target_width) if rotated else (target_width, target_height)
            img.draft(mode, draft_size)
            if img.width * img.height > _MAX_DECODED_PIXELS:
                return data, content_type
            # Phone orientation must survive stripping metadata into WebP.
            # Transpose after draft so a JPEG rotates the reduced bitmap.
            ImageOps.exif_transpose(img, in_place=True)
            source = img if img.mode == mode else img.convert(mode)
            resized = source.resize(
                (target_width, target_height), Image.Resampling.LANCZOS, reducing_gap=3.0,
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
    # Versions are opaque to clients. Microseconds prevent two photo edits in
    # the same second from sharing a browser/edge cache key.
    epoch = int(updated_at.replace(microsecond=0).timestamp()) * 1_000_000 + updated_at.microsecond
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

    image_url = _image_url(product_id, now)
    product.image_url = image_url
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
    # Session.commit() expires ORM attributes. Reading product.image_url here
    # would start a new transaction after the transaction-local RLS context has
    # been cleared, so return the value already used for the committed update.
    return ProductImageUploadResponse(image_url=image_url)


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
    # Admit before loading the original blob, not just before decoding it.
    # Concurrent cold grids must not retain forty 1 MB originals while one
    # bounded decoder is working on the small resident instance.
    with _image_load_slots:
        return _load_product_image(product_id, db, w)


def _load_product_image(product_id: UUID, db: Session, w: int | None):
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

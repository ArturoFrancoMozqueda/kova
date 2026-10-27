import base64
import binascii
import hashlib
import io
import logging
import sys
from collections import OrderedDict
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import BoundedSemaphore, Lock
from time import perf_counter
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import LargeBinary, cast, func, literal, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Session
from sqlalchemy.types import Text
from starlette.concurrency import run_in_threadpool

if sys.platform != "emscripten":
    from PIL import (
        Image,
        ImageOps,
        WebPImagePlugin,  # noqa: F401 -- register encoder before serving the first photo
    )

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.catalog.models import Product, ProductImageFile
from app.db import (
    SessionLocal,
    get_db,
    get_privileged_db,
    prepare_public_asset_read,
    set_tenant_context,
)
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission, has_permission
from app.shared.dependencies import get_current_session, require_permission
from app.shared.exceptions import bad_request, forbidden, not_found
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
_THUMBNAIL_STRIPE_PIXELS = 1_000_000
_resized_images: OrderedDict[tuple[bytes, str, int], tuple[bytes, str]] = OrderedDict()
_resized_image_bytes = 0
_image_cache_lock = Lock()
_image_resize_lock = Lock()
_image_load_slots = BoundedSemaphore(4)
_thumbnail_write_slots = BoundedSemaphore(1)
_MAX_PERSISTED_THUMBNAIL_BYTES = 128 * 1024
logger = logging.getLogger(__name__)


def _cached_thumbnail(key: tuple[bytes, str, int]) -> tuple[bytes, str] | None:
    with _image_cache_lock:
        cached = _resized_images.get(key)
        if cached is not None:
            _resized_images.move_to_end(key)
        return cached


def _remember_thumbnail(key, result):
    global _resized_image_bytes
    with _image_cache_lock:
        old = _resized_images.pop(key, None)
        if old is not None:
            _resized_image_bytes -= len(old[0])
        while _resized_images and _resized_image_bytes + len(result[0]) > _RESIZE_CACHE_BYTES:
            _, evicted = _resized_images.popitem(last=False)
            _resized_image_bytes -= len(evicted[0])
        _resized_images[key] = result
        _resized_image_bytes += len(result[0])


def _persisted_metadata_matches(entry, fingerprint: bytes, source_content_type: str):
    if not isinstance(entry, dict) or set(entry) != {
        "source_sha256", "source_content_type", "content_type", "body_base64",
    }:
        return False
    if (entry["source_sha256"] != fingerprint.hex()
            or entry["source_content_type"] != source_content_type
            or source_content_type not in ALLOWED_CONTENT_TYPES
            or entry["content_type"] != "image/webp"):
        return False
    encoded = entry["body_base64"]
    return (isinstance(encoded, str) and 0 < len(encoded)
            <= 4 * ((_MAX_PERSISTED_THUMBNAIL_BYTES + 2) // 3))


def _persisted_thumbnail(entry, fingerprint: bytes, source_content_type: str, width: int):
    if not _persisted_metadata_matches(entry, fingerprint, source_content_type):
        return None
    encoded = entry["body_base64"]
    try:
        body = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return None
    if (len(body) > _MAX_PERSISTED_THUMBNAIL_BYTES or len(body) < 20
            or body[:4] != b"RIFF" or body[8:12] != b"WEBP"):
        return None
    size = _webp_canvas_size(body)
    if size is None or size[0] != width or size[0] * size[1] > _MAX_DECODED_PIXELS:
        return None
    return body, "image/webp"


def _persist_thumbnail(image_id: UUID, tenant_id: UUID, product_id: UUID,
                       width: int, entry: dict, *, session_factory=None) -> bool:
    """Optional derived cache write; own RLS session, no request connection.

    BackgroundTasks runs this sync function after the response body is sent.
    A busy writer or a failed/obsolete write can safely be dropped: the next
    request still has the original image and the bounded in-process LRU.
    """
    if width not in ALLOWED_RESIZE_WIDTHS:
        return False
    try:
        fingerprint = bytes.fromhex(entry["source_sha256"])
        if (len(fingerprint) != 32 or _persisted_thumbnail(
                entry, fingerprint, entry["source_content_type"], width) is None):
            return False
    except (KeyError, TypeError, ValueError):
        return False
    if not _thumbnail_write_slots.acquire(blocking=False):
        return False
    db = None
    try:
        db = (session_factory or SessionLocal)()
        set_tenant_context(db, tenant_id)
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '250ms'"))
        active_product = select(Product.id).where(
            Product.id == product_id, Product.tenant_id == tenant_id,
            Product.is_active.is_(True),
        ).exists()
        result = db.execute(update(ProductImageFile).where(
            ProductImageFile.id == image_id,
            ProductImageFile.product_id == product_id,
            ProductImageFile.tenant_id == tenant_id,
            func.encode(func.pg_catalog.sha256(ProductImageFile.bytes_data), "hex")
            == entry["source_sha256"],
            ProductImageFile.content_type == entry["source_content_type"],
            active_product,
        ).values(
            thumbnail_variants=func.jsonb_set(
                func.coalesce(ProductImageFile.thumbnail_variants, cast(literal("{}"), JSONB)),
                cast([str(width)], ARRAY(Text)), cast(entry, JSONB), True,
            ),
            # Derived data must not change the public upload revision.
            updated_at=ProductImageFile.updated_at,
        ).execution_options(synchronize_session=False))
        db.commit()
        return result.rowcount == 1
    except Exception:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        logger.warning("product_thumbnail_cache_write_failed")
        return False
    finally:
        try:
            if db is not None:
                db.close()
        except Exception:
            logger.warning("product_thumbnail_cache_close_failed")
        finally:
            _thumbnail_write_slots.release()


def _queue_thumbnail(image_id, tenant_id, product_id, width, fingerprint,
                     source_content_type, result, background_tasks):
    if result[1] != "image/webp" or len(result[0]) > _MAX_PERSISTED_THUMBNAIL_BYTES:
        return
    entry = {
        "source_sha256": fingerprint.hex(),
        "source_content_type": source_content_type,
        "content_type": result[1],
        "body_base64": base64.b64encode(result[0]).decode("ascii"),
    }
    args = (image_id, tenant_id, product_id, width, entry)
    if background_tasks is None:
        _persist_thumbnail(*args)
    else:
        background_tasks.add_task(_persist_thumbnail, *args)


def _prepare_upload_variants(data: bytes, content_type: str,
                             widths: set[int] | None = None) -> dict | None:
    if sys.platform == "emscripten":
        return None
    fingerprint = hashlib.sha256(data).hexdigest()
    variants = {}
    with _image_load_slots:
        for width in sorted(ALLOWED_RESIZE_WIDTHS if widths is None
                            else ALLOWED_RESIZE_WIDTHS.intersection(widths)):
            body, actual_type = _resize_to_width(data, content_type, width)
            if (body is data or actual_type != "image/webp"
                    or len(body) > _MAX_PERSISTED_THUMBNAIL_BYTES):
                continue
            variants[str(width)] = {
                "source_sha256": fingerprint,
                "source_content_type": content_type,
                "content_type": actual_type,
                "body_base64": base64.b64encode(body).decode("ascii"),
            }
    return variants or None


def _revalidate_image_upload(request: Request, db: Session, tenant_id: UUID, user_id: UUID,
                             product_id: UUID):
    user, membership, _ = get_current_session(request, db)
    if (membership.tenant_id != tenant_id or user.id != user_id
            or not has_permission(membership.role, Permission.CATALOG_UPDATE)):
        raise forbidden()
    product = _load_product(db, tenant_id=tenant_id, product_id=product_id)
    return user, membership, product


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
    cached = _cached_thumbnail(key)
    if cached is not None:
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
        _remember_thumbnail(key, result)
        return result


def _webp_canvas_size(data: bytes) -> tuple[int, int] | None:
    """Read the first RIFF image header without creating libwebp's canvas.

    VP8X dimensions are 24-bit values minus one; VP8L packs two 14-bit
    values minus one; VP8 keyframes store two 14-bit dimensions directly.
    Malformed/unknown containers retain the original-file fallback.
    """
    if len(data) < 20 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    size = int.from_bytes(data[4:8], "little") + 8
    chunk_size = int.from_bytes(data[16:20], "little")
    if size > len(data) or size < 20 + chunk_size + (chunk_size & 1):
        return None
    chunk = data[12:16]
    if chunk == b"VP8X" and chunk_size == 10:
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    if chunk == b"VP8L" and chunk_size >= 5 and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        if bits >> 29 == 0:  # Version 0 is the defined lossless bitstream.
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if (chunk == b"VP8 " and chunk_size >= 10 and not data[20] & 1
            and data[23:26] == b"\x9d\x01\x2a"):
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        if width and height:
            return width, height
    return None


def _resize_rgba_in_stripes(source, size):
    """Match Pillow's gap=2 RGBA resize without a full premultiplied canvas.

    Integer reduction uses the same premultiplied RGBa samples as Pillow.
    Aligned stripes retain partial edge blocks and the fractional final box;
    only the temporary working set changes, not the resampling or quality.
    Other modes, small reductions and unbounded stripe geometries retain the
    original Pillow path and its existing allocation behavior.
    """
    factor_x = max(1, int(source.width / size[0] / 2.0))
    factor_y = max(1, int(source.height / size[1] / 2.0))
    if (source.mode != "RGBA" or factor_x == factor_y == 1
            or source.width * factor_y > _THUMBNAIL_STRIPE_PIXELS):
        return source.resize(size, Image.Resampling.LANCZOS, reducing_gap=2.0)
    stripe_height = (_THUMBNAIL_STRIPE_PIXELS // source.width // factor_y) * factor_y
    reduced_size = ((source.width + factor_x - 1) // factor_x,
                    (source.height + factor_y - 1) // factor_y)
    # Pillow's Image context manager does not destroy its pixel buffer.
    # closing() is deliberate: release every stripe before allocating another.
    with closing(Image.new("RGBa", reduced_size)) as reduced:
        for top in range(0, source.height, stripe_height):
            box = (0, top, source.width, min(source.height, top + stripe_height))
            with (closing(source.crop(box)) as tile,
                  closing(tile.convert("RGBa")) as premultiplied,
                  closing(premultiplied.reduce((factor_x, factor_y))) as small):
                reduced.paste(small, (0, top // factor_y))
        box = (0, 0, source.width / factor_x, source.height / factor_y)
        with closing(reduced.resize(size, Image.Resampling.LANCZOS, box=box)) as final:
            return final.convert("RGBA")


def _render_thumbnail(data: bytes, content_type: str, target_width: int) -> tuple[bytes, str]:
    try:
        # WebP allocates its canvas inside Image.open(), before Pillow exposes
        # dimensions. Preflight the actual bytes rather than the declared MIME.
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            size = _webp_canvas_size(data)
            if size is None or size[0] * size[1] > _MAX_DECODED_PIXELS:
                return data, content_type
            # Animated WebP allocates multiple full-size canvases even when
            # only its first frame is requested. Preserve the original
            # animation instead of exceeding the resident memory budget.
            if data[12:16] == b"VP8X" and data[20] & 0x02:
                return data, content_type
        with Image.open(io.BytesIO(data)) as img:
            # PNG.getexif() can load the full bitmap. Check first, except JPEG
            # which can reduce its decode dimensions with draft() below.
            if img.format != "JPEG" and img.width * img.height > _MAX_DECODED_PIXELS:
                return data, content_type
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
            with closing(_resize_rgba_in_stripes(source, (target_width, target_height))) as resized:
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

    tenant_id, user_id = membership.tenant_id, user.id
    # All authentication/product objects below must be fresh after closing
    # this read transaction. CPU work holds no connection and cannot block
    # the ASGI event loop. Revalidate revocation/permissions before mutation.
    db.close()
    prepared = await run_in_threadpool(_prepare_upload_variants, parsed.data, parsed.content_type)
    user, membership, product = await run_in_threadpool(
        _revalidate_image_upload, request, db, tenant_id, user_id, product_id,
    )

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
    image.thumbnail_variants = prepared
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
    background_tasks: BackgroundTasks = None,
):
    # Admit before loading the original blob, not just before decoding it.
    # Concurrent cold grids must not retain forty 1 MB originals while one
    # bounded decoder is working on the small resident instance.
    with _image_load_slots:
        return _load_product_image(product_id, db, w, background_tasks)


def _load_product_image(product_id: UUID, db: Session, w: int | None,
                        background_tasks: BackgroundTasks | None = None):
    started = perf_counter()
    prepare_public_asset_read(db)
    # Include checkout/pre-ping here too: changing transaction transport must
    # not make the database timer appear faster by moving work outside it.
    db_ms = (perf_counter() - started) * 1000
    cache_ms = resize_ms = 0.0
    visible_image = (
        select(ProductImageFile.bytes_data, ProductImageFile.content_type)
        .join(Product, Product.id == ProductImageFile.product_id)
        .where(
            ProductImageFile.product_id == product_id,
            ProductImageFile.tenant_id == Product.tenant_id,
            Product.is_active.is_(True),
        )
    )

    # PostgreSQL's built-in bytea SHA-256 returns only 32 bytes. Recheck the
    # current public visibility and actual contents on every request before
    # reusing a thumbnail; IDs, timestamps and caller-provided v can all stay
    # unchanged when a stored image is replaced. Workers keep their original
    # no-transform path, and other dialects need no SHA function extension.
    persistent = (sys.platform != "emscripten" and w in ALLOWED_RESIZE_WIDTHS
                  and db.get_bind().dialect.name == "postgresql")
    if persistent:
        started = perf_counter()
        fingerprint_row = db.execute(visible_image.with_only_columns(
            func.pg_catalog.sha256(ProductImageFile.bytes_data, type_=LargeBinary),
            ProductImageFile.content_type, ProductImageFile.thumbnail_variants[str(w)],
            ProductImageFile.id, ProductImageFile.tenant_id,
        )).one_or_none()
        db_ms += (perf_counter() - started) * 1000
        if fingerprint_row is None:
            raise not_found("Product image not found")
        fingerprint, content_type, persisted, image_id, tenant_id = fingerprint_row
        started = perf_counter()
        key = (bytes(fingerprint), content_type, w)
        cached = _cached_thumbnail(key)
        if cached is None:
            cached = _persisted_thumbnail(persisted, bytes(fingerprint), content_type, w)
            if cached is not None:
                _remember_thumbnail(key, cached)
        cache_ms += (perf_counter() - started) * 1000
        if cached is not None:
            db.close()
            # A previous optional writer may have been busy. Retry missing
            # persistence from a verified memory hit without reloading a blob.
            if not _persisted_metadata_matches(persisted, bytes(fingerprint), content_type):
                _queue_thumbnail(image_id, tenant_id, product_id, w, bytes(fingerprint),
                                 content_type, cached, background_tasks)
            return _image_response(*cached, db_ms=db_ms, cache_ms=cache_ms, resize_ms=resize_ms)

    started = perf_counter()
    blob_query = (visible_image.add_columns(ProductImageFile.id, ProductImageFile.tenant_id)
                  if persistent else visible_image)
    image_row = db.execute(blob_query).one_or_none()
    db_ms += (perf_counter() - started) * 1000
    if image_row is None:
        raise not_found("Product image not found")

    if persistent:
        body, media_type, image_id, tenant_id = image_row
    else:
        body, media_type = image_row
    db.close()
    original, source_content_type = body, media_type
    if w is not None and w in ALLOWED_RESIZE_WIDTHS:
        started = perf_counter()
        # A replacement between fingerprint and blob reads must be cached
        # under the actual bytes just fetched, never the earlier fingerprint.
        body, media_type = _resize_to_width(body, media_type, w)
        resize_ms += (perf_counter() - started) * 1000

    if (persistent and body is not original and media_type == "image/webp"
            and len(body) <= _MAX_PERSISTED_THUMBNAIL_BYTES):
        _queue_thumbnail(image_id, tenant_id, product_id, w, hashlib.sha256(original).digest(),
                         source_content_type, (body, media_type), background_tasks)
    return _image_response(body, media_type, db_ms=db_ms, cache_ms=cache_ms, resize_ms=resize_ms)


def _image_response(body, media_type, *, db_ms, cache_ms, resize_ms):
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "Server-Timing": (
                f"image-db;dur={db_ms:.3f}, image-cache;dur={cache_ms:.3f}, "
                f"image-resize;dur={resize_ms:.3f}"
            ),
        },
    )

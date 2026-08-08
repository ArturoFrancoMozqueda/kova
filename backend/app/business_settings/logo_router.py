from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.business_settings.models import ReceiptSettings, TenantLogoFile
from app.db import get_db, get_privileged_db
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, not_found
from app.shared.validation import verify_image_signature
from app.tenants.repository import get_by_id as get_tenant_by_id

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

# SVG is intentionally excluded: it can carry embedded scripts (XSS via the
# logo render surface). Raster-only keeps the upload safe.
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_LOGO_BYTES = 512 * 1024


class LogoUploadResponse(BaseModel):
    logo_url: str


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


async def _parse_logo_upload(request: Request) -> ParsedMultipartFile:
    media_type, params = _parse_content_type_header(request.headers.get("content-type", ""))
    boundary = params.get("boundary")
    if media_type != "multipart/form-data" or not boundary:
        raise bad_request("Logo upload must be multipart/form-data.")

    body = await request.body()
    if len(body) > MAX_LOGO_BYTES + 16_384:
        raise bad_request("Logo must be 512 KB or smaller.")

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
        if disposition_params.get("name") not in {"file", "logo"}:
            continue
        content_type = headers.get("content-type", "").lower()
        return ParsedMultipartFile(content_type=content_type, data=data.rstrip(b"\r\n"))

    raise bad_request("Logo file is required.")


def _logo_url(tenant_id: UUID, updated_at: datetime) -> str:
    epoch = int(updated_at.timestamp())
    return f"/api/v1/settings/receipt/logo/{tenant_id}?v={epoch}"


@router.post(
    "/receipt/logo",
    response_model=LogoUploadResponse,
    dependencies=[Depends(rate_limit(10, key="settings-logo-upload"))],
)
async def upload_receipt_logo(
    request: Request,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    parsed = await _parse_logo_upload(request)
    if parsed.content_type not in ALLOWED_CONTENT_TYPES:
        raise bad_request("Logo must be PNG, JPEG, or WebP.")
    if len(parsed.data) > MAX_LOGO_BYTES:
        raise bad_request("Logo must be 512 KB or smaller.")
    verify_image_signature(parsed.content_type, parsed.data)

    now = datetime.now(UTC)
    logo = (
        db.query(TenantLogoFile)
        .filter(TenantLogoFile.tenant_id == membership.tenant_id)
        .one_or_none()
    )
    if logo is None:
        logo = TenantLogoFile(tenant_id=membership.tenant_id, created_at=now)
        db.add(logo)

    logo.content_type = parsed.content_type
    logo.bytes_data = parsed.data
    logo.byte_size = len(parsed.data)
    logo.updated_at = now

    settings = db.get(ReceiptSettings, membership.tenant_id)
    if settings is None:
        settings = ReceiptSettings(
            tenant_id=membership.tenant_id,
            receipt_business_name=get_tenant_by_id(db, membership.tenant_id).name,
            created_at=now,
        )
        db.add(settings)
    logo_url = _logo_url(membership.tenant_id, now)
    settings.logo_url = logo_url
    settings.updated_at = now

    audit_service.log(
        db,
        action="settings.logo.upload",
        tenant_id=membership.tenant_id,
        user_id=user.id,
        resource_type="tenant_logo_file",
        resource_id=logo.id,
        changes={"content_type": logo.content_type, "byte_size": logo.byte_size},
    )
    db.commit()
    # Session.commit() expires ORM attributes and clears the transaction-local
    # RLS context. Return the value already persisted instead of starting an
    # unsafe post-commit refresh of tenant_receipt_settings.
    return LogoUploadResponse(logo_url=logo_url)


@router.delete(
    "/receipt/logo",
    status_code=204,
    dependencies=[Depends(rate_limit(10, key="settings-logo-delete"))],
)
def delete_receipt_logo(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    logo = (
        db.query(TenantLogoFile)
        .filter(TenantLogoFile.tenant_id == membership.tenant_id)
        .one_or_none()
    )
    if logo is not None:
        db.delete(logo)

    settings = db.get(ReceiptSettings, membership.tenant_id)
    if settings is not None:
        settings.logo_url = None
        settings.updated_at = datetime.now(UTC)

    audit_service.log(
        db,
        action="settings.logo.delete",
        tenant_id=membership.tenant_id,
        user_id=user.id,
        resource_type="tenant_logo_file",
        resource_id=logo.id if logo else None,
    )
    db.commit()
    return Response(status_code=204)


@router.get(
    "/receipt/logo/{tenant_id}",
    dependencies=[Depends(rate_limit(120, key="receipt-logo-get"))],
)
def get_receipt_logo(
    tenant_id: UUID,
    # Public, unauthenticated read served cross-tenant by tenant id (logos render
    # on shared receipts, no session). Privileged engine (RLS bypass).
    db: Session = Depends(get_privileged_db),
):
    tenant = get_tenant_by_id(db, tenant_id)
    if tenant is None:
        raise not_found("Tenant logo not found")

    logo = db.query(TenantLogoFile).filter(TenantLogoFile.tenant_id == tenant_id).one_or_none()
    if logo is None:
        raise not_found("Tenant logo not found")

    return Response(
        content=logo.bytes_data,
        media_type=logo.content_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            # Logos may be SVG. Served from the API origin and reachable
            # unauthenticated, a malicious SVG opened directly could run script
            # (stored XSS). `sandbox` forces a unique origin with scripts
            # disabled; nosniff stops content-type confusion. Inline <img> use
            # on receipts is unaffected (images never execute SVG script).
            "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
        },
    )

from typing import Literal

from fastapi import APIRouter, Body, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.imports import service
from app.imports.schemas import CatalogImportResponse
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/catalog/import", tags=["catalog-import"])


@router.get("/template")
def download_template(
    _: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_CREATE)
    ),
):
    return Response(
        content=service.TEMPLATE_CSV,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla-catalogo-kova.csv"'},
    )


@router.post("", response_model=CatalogImportResponse)
def import_catalog(
    response: Response,
    content: bytes = Body(media_type="application/octet-stream"),
    dry_run: bool = Query(default=True),
    file_format: Literal["csv", "xlsx"] = Query(default="csv", alias="format"),
    content_type: str | None = Header(default=None, alias="Content-Type"),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_CREATE)
    ),
):
    user, membership, _ = ctx
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    allowed_media_types = {
        "csv": {"text/csv", "application/csv", "application/vnd.ms-excel"},
        "xlsx": {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
    }
    if media_type not in allowed_media_types[file_format]:
        raise bad_request(
            f"El tipo de archivo no coincide con el formato {file_format.upper()} seleccionado"
        )
    if dry_run:
        return service.validate_catalog_import(
            db,
            tenant_id=membership.tenant_id,
            content=content,
            file_format=file_format,
        )
    if not idempotency_key:
        raise bad_request("Idempotency-Key header is required")
    status_code, body = service.commit_catalog_import(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        content=content,
        idempotency_key=idempotency_key,
        file_format=file_format,
    )
    response.status_code = status_code
    return body

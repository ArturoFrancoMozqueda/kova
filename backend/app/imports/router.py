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
    content: bytes = Body(media_type="text/csv"),
    dry_run: bool = Query(default=True),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_CREATE)
    ),
):
    user, membership, _ = ctx
    if dry_run:
        return service.validate_catalog_csv(
            db, tenant_id=membership.tenant_id, content=content
        )
    if not idempotency_key:
        raise bad_request("Idempotency-Key header is required")
    status_code, body = service.commit_catalog_csv(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        content=content,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return body

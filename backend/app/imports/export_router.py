from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.imports import export
from app.rbac.permissions import Permission

router = APIRouter(prefix="/api/v1/catalog/export", tags=["catalog-import"])


@router.get("")
def export_catalog(
    file_format: Literal["csv", "xlsx"] = Query(default="csv", alias="format"),
    db: Session = Depends(get_db),
    # Same people who import: the file carries prices and costs.
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.CATALOG_CREATE)
    ),
):
    rows = export.catalog_rows(db, tenant_id=ctx[1].tenant_id)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    if file_format == "xlsx":
        return Response(
            content=export.to_xlsx(rows),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="catalogo-kova-{stamp}.xlsx"'},
        )
    return Response(
        content=export.to_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="catalogo-kova-{stamp}.csv"'},
    )

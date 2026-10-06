from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.account_lifecycle import service
from app.account_lifecycle.schemas import (
    DeletionStatusResponse,
    PurgeResponse,
    ScheduleDeletionRequest,
)
from app.auth.models import Membership, User, UserSession
from app.config import settings
from app.db import get_db, get_privileged_db
from app.rbac.permissions import Permission, has_permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import forbidden

router = APIRouter(tags=["account-lifecycle"])


def _owner_context(
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
) -> tuple[User, Membership, UserSession]:
    _, membership, _ = ctx
    if not (
        has_permission(membership.role, Permission.USERS_MANAGE)
        and has_permission(membership.role, Permission.BILLING_MANAGE)
    ):
        raise forbidden()
    return ctx


@router.get("/api/v1/export/account")
def export_account(
    ctx: tuple[User, Membership, UserSession] = Depends(_owner_context),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    _, membership, _ = ctx
    export_file = service.build_account_export(db, tenant_id=membership.tenant_id)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d")
    return StreamingResponse(
        iter(lambda: export_file.read(64 * 1024), b""),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="kova-export-{stamp}.zip"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(export_file.close),
    )


@router.get("/api/v1/account/deletion", response_model=DeletionStatusResponse)
def deletion_status(
    ctx: tuple[User, Membership, UserSession] = Depends(_owner_context),
    db: Session = Depends(get_db),
) -> DeletionStatusResponse:
    _, membership, _ = ctx
    request = service.get_deletion_status(db, tenant_id=membership.tenant_id)
    if not request:
        return DeletionStatusResponse(status="none")
    return DeletionStatusResponse(
        status=request.status,
        requested_at=request.requested_at,
        purge_after=request.purge_after,
    )


@router.post("/api/v1/account/deletion", response_model=DeletionStatusResponse)
def schedule_deletion(
    body: ScheduleDeletionRequest,
    ctx: tuple[User, Membership, UserSession] = Depends(_owner_context),
    db: Session = Depends(get_db),
) -> DeletionStatusResponse:
    user, membership, _ = ctx
    request = service.schedule_deletion(
        db,
        tenant_id=membership.tenant_id,
        user=user,
        password=body.password,
        tenant_name=body.tenant_name,
    )
    return DeletionStatusResponse(
        status=request.status,
        requested_at=request.requested_at,
        purge_after=request.purge_after,
    )


@router.delete("/api/v1/account/deletion", response_model=DeletionStatusResponse)
def cancel_deletion(
    ctx: tuple[User, Membership, UserSession] = Depends(_owner_context),
    db: Session = Depends(get_db),
) -> DeletionStatusResponse:
    user, membership, _ = ctx
    request = service.cancel_deletion(
        db, tenant_id=membership.tenant_id, user_id=user.id
    )
    return DeletionStatusResponse(status=request.status if request else "none")


@router.post(
    "/api/v1/account/internal/deletions/purge",
    response_model=PurgeResponse,
    tags=["internal"],
)
def purge_deletions(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
) -> PurgeResponse:
    if not settings.internal_api_key or x_internal_key != settings.internal_api_key:
        raise forbidden("Invalid or missing internal API key")
    return PurgeResponse(purged=service.purge_due_accounts(db))

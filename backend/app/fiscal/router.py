import hmac
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.config import settings
from app.db import get_db, get_privileged_db
from app.fiscal import service
from app.fiscal.schemas import (
    FiscalAutoCloseRequest,
    FiscalAutoCloseResponse,
    FiscalGlobalDraftBatchListResponse,
    FiscalGlobalDraftBatchResponse,
    FiscalGlobalDraftClose,
    FiscalGlobalDraftPreviewResponse,
    FiscalGlobalDraftSettingsResponse,
    FiscalGlobalDraftSettingsUpsert,
    FiscalIndividualInvoiceCurrentResponse,
    FiscalIndividualInvoiceResponse,
    FiscalIndividualInvoiceUpdate,
)
from app.rbac.permissions import Permission
from app.shared.exceptions import bad_request, forbidden
from app.tenants import repository as tenant_repo
from app.tenants.feature_flags import FISCAL_GLOBAL_DRAFTS, resolve_feature_flags

router = APIRouter(prefix="/api/v1/fiscal", tags=["fiscal"])


def _idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
    if not value:
        raise bad_request("Idempotency-Key header is required")
    return value


def require_fiscal_global_drafts(permission: Permission):
    def dependency(
        db: Session = Depends(get_db),
        ctx: tuple[User, Membership, UserSession] = Depends(require_commercial_access(permission)),
    ) -> tuple[User, Membership, UserSession]:
        _, membership, _ = ctx
        tenant = tenant_repo.get_by_id(db, membership.tenant_id)
        flags = resolve_feature_flags(tenant.feature_overrides if tenant else None)
        if not flags[FISCAL_GLOBAL_DRAFTS]:
            raise forbidden(
                "Los borradores internos por periodo no están habilitados para este negocio"
            )
        return ctx

    return dependency


@router.get(
    "/global-drafts/settings",
    response_model=FiscalGlobalDraftSettingsResponse,
)
def get_global_draft_settings(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_settings(db, tenant_id=membership.tenant_id)


@router.put(
    "/global-drafts/settings",
    response_model=FiscalGlobalDraftSettingsResponse,
)
def put_global_draft_settings(
    body: FiscalGlobalDraftSettingsUpsert,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.upsert_settings(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        body=body,
    )


@router.get(
    "/global-drafts/preview",
    response_model=FiscalGlobalDraftPreviewResponse,
)
def preview_global_draft(
    period_end: date = Query(),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.preview(db, tenant_id=membership.tenant_id, period_end=period_end)


@router.post(
    "/global-drafts/close",
    response_model=FiscalGlobalDraftBatchResponse,
    status_code=201,
)
def close_global_draft(
    body: FiscalGlobalDraftClose,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, response_body = service.close_period(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        period_end=body.period_end,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return response_body


@router.get(
    "/global-drafts/batches",
    response_model=FiscalGlobalDraftBatchListResponse,
)
def list_global_draft_batches(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.list_batches(db, tenant_id=membership.tenant_id, limit=limit, offset=offset)


@router.get(
    "/global-drafts/batches/{batch_id}",
    response_model=FiscalGlobalDraftBatchResponse,
)
def get_global_draft_batch(
    batch_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_batch(db, tenant_id=membership.tenant_id, batch_id=batch_id)


@router.get(
    "/global-drafts/batches/{batch_id}/accountant-report.csv",
    response_class=Response,
    responses={
        200: {
            "description": "CSV UTF-8 de control interno; no es CFDI ni constancia de timbrado.",
            "content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
def download_accountant_report(
    batch_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    content, filename = service.accountant_report_csv(
        db, tenant_id=membership.tenant_id, batch_id=batch_id
    )
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/global-drafts/batches/{batch_id}/accountant-package.zip",
    response_class=Response,
    responses={
        200: {
            "description": "Paquete ZIP de evidencia para contador; no es CFDI.",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
def download_accountant_package(
    batch_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    content, filename = service.accountant_package_zip(
        db, tenant_id=membership.tenant_id, batch_id=batch_id
    )
    return Response(
        content=content,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/global-drafts/orders/{order_id}/individual-invoice",
    response_model=FiscalIndividualInvoiceResponse,
    status_code=201,
)
def update_individual_invoice_status(
    order_id: UUID,
    body: FiscalIndividualInvoiceUpdate,
    response: Response,
    db: Session = Depends(get_db),
    idempotency_key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_MANAGE)
    ),
):
    user, membership, _ = ctx
    status_code, result = service.record_individual_invoice_status(
        db,
        tenant_id=membership.tenant_id,
        user_id=user.id,
        order_id=order_id,
        body=body,
        idempotency_key=idempotency_key,
    )
    response.status_code = status_code
    return result


@router.get(
    "/global-drafts/orders/{order_id}/individual-invoice",
    response_model=FiscalIndividualInvoiceCurrentResponse,
)
def get_individual_invoice_status(
    order_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_fiscal_global_drafts(Permission.FISCAL_VIEW)
    ),
):
    _, membership, _ = ctx
    return service.get_individual_invoice_status(
        db, tenant_id=membership.tenant_id, order_id=order_id
    )


@router.post(
    "/internal/global-drafts/auto-close",
    response_model=FiscalAutoCloseResponse,
    include_in_schema=False,
)
def auto_close_global_drafts(
    body: FiscalAutoCloseRequest,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
):
    expected = settings.internal_api_key
    if (
        not expected
        or not x_internal_key
        or not hmac.compare_digest(x_internal_key.encode("utf-8"), expected.encode("utf-8"))
    ):
        raise forbidden("Invalid or missing internal API key")
    return service.auto_close_due_periods(
        db,
        tenant_limit=body.tenant_limit,
        periods_per_tenant=body.periods_per_tenant,
    )

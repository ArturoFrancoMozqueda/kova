from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.business_settings import service
from app.business_settings.schemas import (
    BusinessProfileResponse,
    BusinessProfileUpsert,
    ReceiptSettingsResponse,
    ReceiptSettingsUpsert,
)
from app.db import get_db
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import not_found
from app.tenants.repository import get_by_id as get_tenant_by_id

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def _tenant_name(db: Session, tenant_id: UUID) -> str:
    tenant = get_tenant_by_id(db, tenant_id)
    if tenant is None:
        raise not_found("Tenant not found")
    return tenant.name


@router.get("/business-profile", response_model=BusinessProfileResponse)
def get_business_profile(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    profile = service.get_business_profile(db, tenant_id=membership.tenant_id)
    if profile is None:
        return BusinessProfileResponse(
            tenant_id=membership.tenant_id,
            public_name=_tenant_name(db, membership.tenant_id),
            support_email=None,
            support_phone=None,
            timezone="America/Mexico_City",
            locale="es-MX",
            currency="MXN",
            created_at=membership.created_at,
            updated_at=membership.created_at,
        )
    return profile


@router.put("/business-profile", response_model=BusinessProfileResponse)
def upsert_business_profile(
    body: BusinessProfileUpsert,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.upsert_business_profile(
        db, tenant_id=membership.tenant_id, user_id=user.id, body=body
    )


@router.get("/receipt", response_model=ReceiptSettingsResponse)
def get_receipt_settings(
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    settings = service.get_receipt_settings(db, tenant_id=membership.tenant_id)
    if settings is None:
        return ReceiptSettingsResponse(
            tenant_id=membership.tenant_id,
            receipt_business_name=_tenant_name(db, membership.tenant_id),
            footer=None,
            tax_contact_text=None,
            logo_url=None,
            paper_width_mm=80,
            created_at=membership.created_at,
            updated_at=membership.created_at,
        )
    return settings


@router.put("/receipt", response_model=ReceiptSettingsResponse)
def upsert_receipt_settings(
    body: ReceiptSettingsUpsert,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.SETTINGS_MANAGE)
    ),
):
    user, membership, _ = ctx
    return service.upsert_receipt_settings(
        db, tenant_id=membership.tenant_id, user_id=user.id, body=body
    )

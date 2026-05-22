from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.business_settings.schemas import BusinessProfileUpsert, ReceiptSettingsUpsert
from app.tenants.models import Tenant


def get_business_profile(db: Session, *, tenant_id: UUID) -> BusinessProfile | None:
    return db.get(BusinessProfile, tenant_id)


def upsert_business_profile(
    db: Session, *, tenant_id: UUID, user_id: UUID, body: BusinessProfileUpsert
) -> BusinessProfile:
    profile = db.get(BusinessProfile, tenant_id)
    now = datetime.now(UTC)
    if profile is None:
        profile = BusinessProfile(tenant_id=tenant_id, created_at=now)
        db.add(profile)
    for field, value in body.model_dump().items():
        setattr(profile, field, value)
    profile.updated_at = now
    # Mirror public_name onto tenants.name so the session probe and every
    # consumer reading from `tenant.name` (sidebar, dashboard greeting,
    # receipt fallback) sees the new name immediately. Without this the
    # value stays out of sync until the row is touched by some other path.
    tenant = db.get(Tenant, tenant_id)
    if tenant is not None and tenant.name != body.public_name:
        tenant.name = body.public_name
    audit_service.log(
        db,
        action="settings.business_profile.upsert",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="tenant",
        resource_id=tenant_id,
        changes=body.model_dump(),
    )
    db.commit()
    db.refresh(profile)
    return profile


def get_receipt_settings(db: Session, *, tenant_id: UUID) -> ReceiptSettings | None:
    return db.get(ReceiptSettings, tenant_id)


def upsert_receipt_settings(
    db: Session, *, tenant_id: UUID, user_id: UUID, body: ReceiptSettingsUpsert
) -> ReceiptSettings:
    settings = db.get(ReceiptSettings, tenant_id)
    now = datetime.now(UTC)
    if settings is None:
        settings = ReceiptSettings(tenant_id=tenant_id, created_at=now)
        db.add(settings)
    for field, value in body.model_dump().items():
        setattr(settings, field, value)
    settings.updated_at = now
    audit_service.log(
        db,
        action="settings.receipt.upsert",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="tenant",
        resource_id=tenant_id,
        changes=body.model_dump(),
    )
    db.commit()
    db.refresh(settings)
    return settings

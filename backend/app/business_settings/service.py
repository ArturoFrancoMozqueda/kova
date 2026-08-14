from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.business_settings import repository
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.business_settings.schemas import BusinessProfileUpsert, ReceiptSettingsUpsert


def _refresh_with_tenant_context(db: Session, instance: object, tenant_id: UUID) -> None:
    """Restore transaction-local RLS context after commit before refreshing."""
    db.execute(
        text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
        {"tenant_id": str(tenant_id)},
    )
    db.refresh(instance)


def get_business_profile(db: Session, *, tenant_id: UUID) -> BusinessProfile | None:
    return repository.get_business_profile(db, tenant_id=tenant_id)


def upsert_business_profile(
    db: Session, *, tenant_id: UUID, user_id: UUID, body: BusinessProfileUpsert
) -> BusinessProfile:
    profile = repository.get_business_profile(db, tenant_id=tenant_id)
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
    tenant = repository.get_tenant(db, tenant_id=tenant_id)
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
    _refresh_with_tenant_context(db, profile, tenant_id)
    return profile


def get_receipt_settings(db: Session, *, tenant_id: UUID) -> ReceiptSettings | None:
    return repository.get_receipt_settings(db, tenant_id=tenant_id)


def upsert_receipt_settings(
    db: Session, *, tenant_id: UUID, user_id: UUID, body: ReceiptSettingsUpsert
) -> ReceiptSettings:
    settings = repository.get_receipt_settings(db, tenant_id=tenant_id)
    now = datetime.now(UTC)
    if settings is None:
        settings = ReceiptSettings(tenant_id=tenant_id, created_at=now)
        db.add(settings)
    values = body.model_dump()
    paper_width_mm = values.pop("paper_width_mm")
    for field, value in values.items():
        setattr(settings, field, value)
    if paper_width_mm is not None:
        settings.paper_width_mm = paper_width_mm
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
    _refresh_with_tenant_context(db, settings, tenant_id)
    return settings

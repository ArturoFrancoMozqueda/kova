from uuid import UUID

from sqlalchemy.orm import Session

from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.tenants.models import Tenant


def get_business_profile(db: Session, *, tenant_id: UUID) -> BusinessProfile | None:
    return db.get(BusinessProfile, tenant_id)


def get_receipt_settings(db: Session, *, tenant_id: UUID) -> ReceiptSettings | None:
    return db.get(ReceiptSettings, tenant_id)


def get_tenant(db: Session, *, tenant_id: UUID) -> Tenant | None:
    return db.get(Tenant, tenant_id)

from sqlalchemy.orm import Session

from app.tenants.models import Tenant


def get_by_id(db: Session, tenant_id: object) -> Tenant | None:
    return db.query(Tenant).filter(Tenant.id == tenant_id).first()


def lock_by_id(db: Session, tenant_id: object) -> Tenant | None:
    """Serialize mutations whose invariant spans several tenant-owned rows."""
    return db.query(Tenant).filter(Tenant.id == tenant_id).with_for_update().first()


def get_by_slug(db: Session, slug: str) -> Tenant | None:
    return db.query(Tenant).filter(Tenant.slug == slug).first()


def create(db: Session, name: str, slug: str) -> Tenant:
    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    db.flush()
    return tenant

from uuid import UUID

from sqlalchemy.orm import Session

from app.billing.models import Subscription


def get_subscription_by_tenant(db: Session, *, tenant_id: UUID) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()

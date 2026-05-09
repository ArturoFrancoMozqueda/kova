from uuid import UUID

from sqlalchemy.orm import Session

from app.billing import repository

STANDARD_PLAN_NAME = "Standard Plan"
STANDARD_PLAN_AMOUNT_MINOR_UNITS = 19_900
STANDARD_PLAN_CURRENCY = "MXN"
STANDARD_PLAN_INTERVAL = "month"


def get_subscription_status(db: Session, *, tenant_id: UUID) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    return {
        "plan": {
            "name": STANDARD_PLAN_NAME,
            "amount_minor_units": STANDARD_PLAN_AMOUNT_MINOR_UNITS,
            "currency": STANDARD_PLAN_CURRENCY,
            "interval": STANDARD_PLAN_INTERVAL,
        },
        "subscription": subscription,
    }

from uuid import UUID

from sqlalchemy.orm import Session

from app.billing.models import Subscription, WebhookEvent


def get_subscription_by_tenant(db: Session, *, tenant_id: UUID) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()


def get_subscription_by_stripe_id(
    db: Session, *, stripe_subscription_id: str
) -> Subscription | None:
    return (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id == stripe_subscription_id)
        .first()
    )


def list_all_subscriptions(
    db: Session, *, offset: int = 0, limit: int = 100
) -> list[Subscription]:
    return (
        db.query(Subscription)
        .order_by(Subscription.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_webhook_event(db: Session, *, stripe_event_id: str) -> WebhookEvent | None:
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.stripe_event_id == stripe_event_id)
        .first()
    )

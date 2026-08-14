from uuid import UUID

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.billing.models import Subscription, WebhookEvent


def get_subscription_by_tenant(db: Session, *, tenant_id: UUID) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()


def lock_subscription_by_tenant(db: Session, *, tenant_id: UUID) -> Subscription | None:
    return (
        db.query(Subscription)
        .filter(Subscription.tenant_id == tenant_id)
        .with_for_update()
        .first()
    )


def lock_billing_tenant(db: Session, *, tenant_id: UUID) -> None:
    """Serialize billing changes even before a tenant has a subscription row."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:tenant_id, 0))"),
        {"tenant_id": str(tenant_id)},
    )


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


def claim_webhook_event(
    db: Session,
    *,
    stripe_event_id: str,
    event_type: str,
    payload: dict,
) -> tuple[WebhookEvent, bool]:
    """Insert-once and lock a webhook row for the whole processing transaction.

    PostgreSQL serializes concurrent deliveries of the same Stripe event at the
    unique constraint. The loser then locks and observes the winner's final
    status, preventing duplicate state changes, audits, and email.
    """
    result = db.execute(
        insert(WebhookEvent)
        .values(
            stripe_event_id=stripe_event_id,
            event_type=event_type,
            payload=payload,
        )
        .on_conflict_do_nothing(index_elements=[WebhookEvent.stripe_event_id])
        .returning(WebhookEvent.id)
    ).scalar_one_or_none()
    event = (
        db.query(WebhookEvent)
        .filter(WebhookEvent.stripe_event_id == stripe_event_id)
        .with_for_update()
        .one()
    )
    return event, result is not None

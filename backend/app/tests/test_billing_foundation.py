from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.billing.models import Subscription, WebhookEvent
from app.rbac.permissions import Permission, has_permission


def test_billing_models_are_mapped(db: Session) -> None:
    inspector = inspect(db.bind)

    assert inspector.has_table(Subscription.__tablename__)
    assert inspector.has_table(WebhookEvent.__tablename__)

    subscription_columns = {column["name"] for column in inspector.get_columns("subscriptions")}
    webhook_columns = {column["name"] for column in inspector.get_columns("webhook_events")}

    assert {
        "tenant_id",
        "stripe_customer_id",
        "stripe_subscription_id",
        "status",
        "currency",
        "amount_minor_units",
        "stripe_lifecycle_watermark_at",
        "stripe_payment_watermark_at",
    }.issubset(subscription_columns)
    assert {"tenant_id", "stripe_event_id", "event_type", "processing_status"}.issubset(
        webhook_columns
    )


def test_owner_has_billing_permissions() -> None:
    assert has_permission("owner", Permission.BILLING_VIEW)
    assert has_permission("owner", Permission.BILLING_MANAGE)
    assert not has_permission("manager", Permission.BILLING_VIEW)
    assert not has_permission("cashier", Permission.BILLING_MANAGE)

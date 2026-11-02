from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.orm_metadata import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latest_checkout_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="incomplete")
    # Operator-managed entitlement, never supplied by a public request or Stripe.
    complimentary_access: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    plan_name: Mapped[str] = mapped_column(String(100), nullable=False, default="Standard Plan")
    # Last confirmed commercial entitlement, independent of a pending Stripe item update.
    plan_code: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standard", server_default="standard"
    )
    plan_effective_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN")
    amount_minor_units: Mapped[int] = mapped_column(Integer, nullable=False, default=29_900)
    current_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stripe_period_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stripe_lifecycle_watermark_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stripe_lifecycle_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_lifecycle_event_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    stripe_payment_watermark_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    stripe_payment_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_payment_event_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    past_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    grace_period_ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_subscriptions_tenant"),
        UniqueConstraint("stripe_customer_id", name="uq_subscriptions_stripe_customer_id"),
        UniqueConstraint(
            "stripe_subscription_id", name="uq_subscriptions_stripe_subscription_id"
        ),
        CheckConstraint(
            "status IN ("
            "'incomplete','incomplete_expired','trialing',"
            "'active','past_due','canceled','unpaid'"
            ")",
            name="ck_subscriptions_status",
        ),
        CheckConstraint("amount_minor_units >= 0", name="ck_subscriptions_amount_non_negative"),
        CheckConstraint(
            "plan_code IN ('standard','esencial','gestion','unknown')",
            name="ck_subscriptions_plan_code",
        ),
        CheckConstraint("currency = upper(currency)", name="ck_subscriptions_currency_uppercase"),
    )


class CheckoutAttempt(Base):
    __tablename__ = "billing_checkout_attempts"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    request_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    credential_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    billing_cohort: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="uncertain")
    stripe_session_id: Mapped[str | None] = mapped_column(String(255))
    stripe_session_url: Mapped[str | None] = mapped_column(String(2048))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_billing_checkout_attempts_tenant"),
        CheckConstraint("billing_cohort IN ('standard','tiered')",
                        name="ck_checkout_attempts_cohort"),
        CheckConstraint("status IN ('uncertain','open','complete','expired')",
                        name="ck_checkout_attempts_status"),
        CheckConstraint("status = 'uncertain' OR stripe_session_id IS NOT NULL",
                        name="ck_checkout_attempts_session"),
    )


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID | None] = mapped_column(nullable=True, index=True)
    stripe_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    processing_status: Mapped[str] = mapped_column(String(30), nullable=False, default="received")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    process_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("stripe_event_id", name="uq_webhook_events_stripe_event_id"),
        CheckConstraint(
            "processing_status IN ('received','processed','ignored','failed')",
            name="ck_webhook_events_processing_status",
        ),
        CheckConstraint("process_attempts >= 0", name="ck_webhook_events_attempts_non_negative"),
    )

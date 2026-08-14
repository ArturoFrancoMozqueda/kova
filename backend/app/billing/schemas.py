from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

BILLING_PERIOD_FRESHNESS_MAX_AGE = timedelta(hours=24)
PeriodFreshness = Literal["verified", "stale", "unavailable"]


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class StandardPlanResponse(BaseModel):
    name: str
    amount_minor_units: int
    currency: str
    interval: str


class SubscriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    status: str
    plan_name: str
    currency: str
    amount_minor_units: int
    current_period_start: datetime | None
    current_period_end: datetime | None
    stripe_period_synced_at: datetime | None = Field(default=None, exclude=True)
    trial_ends_at: datetime | None
    past_due_at: datetime | None
    grace_period_ends_at: datetime | None
    cancel_at_period_end: bool
    canceled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def period_freshness(self) -> PeriodFreshness:
        if self.current_period_end is None:
            return "unavailable"
        now = datetime.now(UTC)
        if (
            _utc(self.current_period_end) > now
            and self.stripe_period_synced_at is not None
            and now - BILLING_PERIOD_FRESHNESS_MAX_AGE
            <= _utc(self.stripe_period_synced_at)
            <= now
        ):
            return "verified"
        return "stale"


class BillingAccessResponse(BaseModel):
    allowed: bool
    reason: str
    trialing: bool
    trial_ends_at: datetime | None
    blocked_at: datetime | None
    recovery_path: str


class BillingSubscriptionResponse(BaseModel):
    plan: StandardPlanResponse
    subscription: SubscriptionResponse | None
    access: BillingAccessResponse


class CheckoutSessionResponse(BaseModel):
    checkout_url: str
    checkout_session_id: str


class ReconcileCheckoutRequest(BaseModel):
    checkout_session_id: str = Field(min_length=1, max_length=255)


class InternalReconcileRequest(BaseModel):
    limit: int = Field(default=100, ge=1, le=500)


class InternalReconcileResponse(BaseModel):
    checked: int
    updated: int
    failed: int


class InternalSubscriptionItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    status: str
    plan_name: str
    currency: str
    amount_minor_units: int
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    current_period_end: datetime | None
    past_due_at: datetime | None
    grace_period_ends_at: datetime | None
    cancel_at_period_end: bool
    canceled_at: datetime | None
    created_at: datetime
    updated_at: datetime


class InternalSubscriptionListResponse(BaseModel):
    items: list[InternalSubscriptionItem]
    total: int

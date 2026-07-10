from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    trial_ends_at: datetime | None
    past_due_at: datetime | None
    grace_period_ends_at: datetime | None
    cancel_at_period_end: bool
    canceled_at: datetime | None
    created_at: datetime
    updated_at: datetime


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

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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


class BillingSubscriptionResponse(BaseModel):
    plan: StandardPlanResponse
    subscription: SubscriptionResponse | None

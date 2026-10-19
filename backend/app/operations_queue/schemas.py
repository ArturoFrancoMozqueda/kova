"""A bounded projection of existing operational records, never a new task ledger."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

OperationsQueueSource = Literal[
    "service_cases", "opportunities", "followups", "appointment_reminders"
]
OperationsQueueRoute = Literal["service_cases", "crm", "followups", "appointments"]
OperationsQueueState = Literal[
    "open", "in_progress", "reopened", "new", "contacted", "proposal", "pending"
]


class OperationsQueueItem(BaseModel):
    source_id: UUID
    title: str
    customer_name: str
    state: OperationsQueueState
    version: int = Field(ge=1)
    due_at: datetime | None
    overdue: bool
    route_key: OperationsQueueRoute


class OperationsQueueSection(BaseModel):
    source: OperationsQueueSource
    items: list[OperationsQueueItem] = Field(max_length=20)
    has_more: bool


class OperationsQueueResponse(BaseModel):
    generated_at: datetime
    sections: list[OperationsQueueSection] = Field(min_length=4, max_length=4)

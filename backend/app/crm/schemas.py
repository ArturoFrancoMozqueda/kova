from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.validation import StrictModel, reject_html, reject_null

Stage = Literal["new", "contacted", "proposal", "won", "lost"]
Channel = Literal["whatsapp", "email"]
Purpose = Literal["transactional", "marketing"]


class _OpportunityFields(StrictModel):
    @field_validator("title", "next_action", "note", mode="before", check_fields=False)
    @classmethod
    def clean_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("title", "next_action", "note", check_fields=False)
    @classmethod
    def plain_text(cls, value):
        return reject_html(value)

    @field_validator("due_at", check_fields=False)
    @classmethod
    def timezone_required(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Incluye la zona horaria del vencimiento")
        return value


class OpportunityCreate(_OpportunityFields):
    customer_id: UUID
    title: str = Field(min_length=1, max_length=160)
    estimated_amount: Decimal = Field(
        default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2
    )
    assigned_user_id: UUID | None = None
    next_action: str | None = Field(default=None, max_length=300)
    due_at: datetime | None = None
    note: str | None = Field(default=None, max_length=1000)


class OpportunityUpdate(_OpportunityFields):
    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    stage: Stage | None = None
    estimated_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    assigned_user_id: UUID | None = None
    next_action: str | None = Field(default=None, max_length=300)
    due_at: datetime | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("title", "stage", "estimated_amount", mode="before")
    @classmethod
    def non_null(cls, value):
        return reject_null(value)


class OpportunityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_id: UUID
    customer_name: str
    title: str
    stage: Stage
    estimated_amount: Decimal
    assigned_user_id: UUID | None
    next_action: str | None
    due_at: datetime | None
    note: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class ConsentWrite(StrictModel):
    customer_id: UUID
    channel: Channel
    purpose: Purpose
    enabled: bool
    expected_version: int = Field(ge=0)


class ConsentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_id: UUID
    customer_name: str
    channel: Channel
    purpose: Purpose
    enabled: bool
    contact_current: bool
    source: Literal["owner_recorded"]
    version: int
    updated_at: datetime


class Capabilities(BaseModel):
    whatsapp: Literal["not_connected"] = "not_connected"
    email: Literal["not_connected"] = "not_connected"


class CrmOverview(BaseModel):
    opportunities: list[OpportunityResponse]
    consents: list[ConsentResponse]
    capabilities: Capabilities = Field(default_factory=Capabilities)
    opportunities_has_more: bool = False
    consents_has_more: bool = False

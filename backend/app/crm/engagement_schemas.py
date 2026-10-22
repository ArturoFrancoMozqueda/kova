from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.crm.schemas import _OpportunityFields
from app.shared.validation import StrictModel, reject_html


class PublicRequestWrite(StrictModel):
    submission_id: UUID
    name: str = Field(min_length=1, max_length=160)
    contact: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=1000)
    product_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("name", "contact", "message")
    @classmethod
    def text(cls, value):
        value = value.strip()
        reject_html(value)
        if not value:
            raise ValueError("El texto no puede estar vacío")
        return value

    @field_validator("product_ids")
    @classmethod
    def unique(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No repitas productos")
        return value


class PublicRequestReceipt(BaseModel):
    receipt_id: UUID
    status: Literal["received"] = "received"


class CatalogRequestResponse(BaseModel):
    id: UUID
    name: str
    contact: str
    message: str
    product_ids: list[UUID]
    status: Literal["new", "converted", "dismissed"]
    customer_id: UUID | None
    opportunity_id: UUID | None
    version: int
    created_at: datetime


class CatalogRequestList(BaseModel):
    requests: list[CatalogRequestResponse]
    has_more: bool


class RequestResolve(StrictModel):
    expected_version: int = Field(ge=1)
    status: Literal["converted", "dismissed"]
    customer_id: UUID | None = None

    @model_validator(mode="after")
    def customer_required(self):
        if (self.status == "converted") != (self.customer_id is not None):
            raise ValueError("Elige un cliente sólo para convertir la solicitud")
        return self


class PolicyWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    review_delay_days: int = Field(ge=1, le=30)
    rebuy_delay_days: int = Field(ge=2, le=365)


class PolicyResponse(BaseModel):
    enabled: bool
    review_delay_days: int
    rebuy_delay_days: int
    version: int


class IncidentWrite(_OpportunityFields):
    customer_id: UUID
    sale_order_id: UUID | None = None
    title: str = Field(min_length=1, max_length=160)
    note: str | None = Field(default=None, max_length=1000)
    due_at: datetime
    assigned_user_id: UUID | None = None


class FollowupUpdate(_OpportunityFields):
    expected_version: int = Field(ge=1)
    status: Literal["completed", "dismissed"] | None = None
    note: str | None = Field(default=None, max_length=1000)
    due_at: datetime | None = None
    assigned_user_id: UUID | None = None

    @field_validator("status", "due_at", mode="before")
    @classmethod
    def not_null(cls, value):
        if value is None:
            raise ValueError("Este campo no puede ser null")
        return value


class FollowupResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: str
    sale_order_id: UUID | None
    kind: Literal["review", "rebuy", "incident"]
    status: Literal["pending", "completed", "dismissed"]
    title: str
    note: str | None
    due_at: datetime
    assigned_user_id: UUID | None
    version: int


class FollowupOverview(BaseModel):
    policy: PolicyResponse
    tasks: list[FollowupResponse]
    has_more: bool


class FollowupProcessResponse(BaseModel):
    created: int

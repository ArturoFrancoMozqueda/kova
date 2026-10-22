from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel, reject_html

ServiceCaseStatus = Literal["open", "in_progress", "resolved", "reopened", "cancelled"]


class _ServiceCaseInput(StrictModel):
    @field_validator("title", "note", mode="before", check_fields=False)
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("title", "note", check_fields=False)
    @classmethod
    def plain(cls, value):
        return reject_html(value)

    @field_validator("due_at", check_fields=False)
    @classmethod
    def aware(cls, value):
        if value is not None:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Incluye la zona horaria del vencimiento")
            return value.astimezone(UTC)
        return value


class ServiceCaseCreate(_ServiceCaseInput):
    customer_id: UUID
    title: str = Field(min_length=1, max_length=160)
    note: str = Field(min_length=1, max_length=2000)
    sale_order_id: UUID | None = None
    customer_order_id: UUID | None = None
    assigned_user_id: UUID | None = None
    due_at: datetime | None = None


class ServiceCaseUpdate(_ServiceCaseInput):
    expected_version: int = Field(ge=1)
    status: ServiceCaseStatus | None = None
    assigned_user_id: UUID | None = None
    due_at: datetime | None = None

    @field_validator("status", mode="before")
    @classmethod
    def not_null(cls, value):
        if value is None:
            raise ValueError("El estado no puede ser nulo")
        return value


class ServiceCaseNoteWrite(_ServiceCaseInput):
    expected_version: int = Field(ge=1)
    note: str = Field(min_length=1, max_length=2000)


class ServiceCaseResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: str
    sale_order_id: UUID | None
    customer_order_id: UUID | None
    title: str
    status: ServiceCaseStatus
    assigned_user_id: UUID | None
    assignee_active: bool
    due_at: datetime | None
    overdue: bool
    version: int
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class ServiceCaseList(BaseModel):
    items: list[ServiceCaseResponse]
    has_more: bool


class ServiceCaseEventResponse(BaseModel):
    id: UUID
    case_id: UUID
    case_version: int
    kind: Literal["created", "updated", "note_added"]
    actor_user_id: UUID
    status: ServiceCaseStatus
    assigned_user_id: UUID | None
    due_at: datetime | None
    note: str | None
    created_at: datetime


class ServiceCaseEventList(BaseModel):
    items: list[ServiceCaseEventResponse]
    has_more: bool


class ServiceCaseAssigneeResponse(BaseModel):
    user_id: UUID
    email: str
    role: str


class ServiceCaseAssigneeList(BaseModel):
    items: list[ServiceCaseAssigneeResponse]
    has_more: bool


class ServiceCaseSaleReference(BaseModel):
    id: UUID
    total_amount: str
    occurred_at: datetime
    status: Literal["completed", "voided"]


class ServiceCaseOrderReference(BaseModel):
    id: UUID
    folio: str
    status: str


class ServiceCaseReferenceList(BaseModel):
    sales: list[ServiceCaseSaleReference]
    customer_orders: list[ServiceCaseOrderReference]
    sales_has_more: bool
    customer_orders_has_more: bool

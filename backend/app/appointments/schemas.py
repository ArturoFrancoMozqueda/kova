from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.shared.validation import StrictModel, reject_html

AppointmentResourceTimezone = Literal[
    "America/Mexico_City",
    "America/Cancun",
    "America/Tijuana",
    "America/Hermosillo",
    "America/Mazatlan",
    "America/Monterrey",
]
AppointmentStatus = Literal["scheduled", "cancelled", "completed", "no_show"]


class _Text(StrictModel):
    @field_validator("title", "name", "note", mode="before", check_fields=False)
    @classmethod
    def clean(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("title", "name", "note", check_fields=False)
    @classmethod
    def plain(cls, value):
        return reject_html(value)


class AppointmentResourceCreate(_Text):
    name: str = Field(min_length=1, max_length=120)
    timezone: AppointmentResourceTimezone


class AppointmentResourceUpdate(_Text):
    expected_version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("name", "is_active", mode="before")
    @classmethod
    def non_null(cls, value):
        if value is None:
            raise ValueError("El campo no puede ser nulo")
        return value


class _Interval(_Text):
    starts_at: datetime
    ends_at: datetime

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Incluye un offset explícito para el horario de la cita")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def ordered(self):
        if not self.starts_at < self.ends_at <= self.starts_at + timedelta(hours=24):
            raise ValueError("La cita debe durar más de cero y hasta 24 horas")
        return self


class AppointmentCreate(_Interval):
    resource_id: UUID
    customer_id: UUID
    title: str = Field(min_length=1, max_length=160)
    note: str | None = Field(default=None, max_length=1000)


class AppointmentReschedule(_Interval):
    expected_version: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class AppointmentTransition(StrictModel):
    expected_version: int = Field(ge=1)
    status: Literal["cancelled", "completed", "no_show"]


class AppointmentReminderResolve(StrictModel):
    expected_version: int = Field(ge=1)
    status: Literal["completed", "dismissed"]


class AppointmentResourceResponse(BaseModel):
    id: UUID
    name: str
    timezone: AppointmentResourceTimezone
    is_active: bool
    version: int


class AppointmentResourceList(BaseModel):
    items: list[AppointmentResourceResponse]


class AppointmentResponse(BaseModel):
    id: UUID
    resource_id: UUID
    resource_name: str
    timezone: AppointmentResourceTimezone
    customer_id: UUID
    customer_name: str
    title: str
    starts_at: datetime
    ends_at: datetime
    note: str | None
    status: AppointmentStatus
    version: int
    created_at: datetime
    updated_at: datetime


class AppointmentList(BaseModel):
    items: list[AppointmentResponse]
    has_more: bool


class AppointmentHistoryResponse(BaseModel):
    id: UUID
    appointment_id: UUID
    appointment_version: int
    action: Literal["created", "rescheduled", "cancelled", "completed", "no_show"]
    status: AppointmentStatus
    starts_at: datetime
    ends_at: datetime
    note: str | None
    actor_user_id: UUID
    created_at: datetime


class AppointmentHistoryList(BaseModel):
    items: list[AppointmentHistoryResponse]


class AppointmentReminderResponse(BaseModel):
    id: UUID
    appointment_id: UUID
    appointment_version: int
    title: str
    starts_at: datetime
    timezone: AppointmentResourceTimezone
    status: Literal["pending", "completed", "dismissed", "suppressed"]
    due_at: datetime
    version: int


class AppointmentReminderList(BaseModel):
    items: list[AppointmentReminderResponse]
    has_more: bool

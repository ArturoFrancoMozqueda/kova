from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.appointments.schemas import _Text
from app.shared.validation import StrictModel


class PageWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    horizon_days: int = Field(default=30, ge=1, le=366)
    notice_minutes: int = Field(default=120, ge=0, le=525600)
    slot_minutes: int = Field(default=15, ge=5, le=120)
    manage_cutoff_hours: int = Field(default=24, ge=0, le=720)
    rotate_link: bool = False
    mode: Literal["appointments", "tables"] | None = None


class ServiceWrite(_Text):
    expected_version: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=500)
    duration_minutes: int = Field(ge=5, le=1440)
    is_active: bool = True
    resource_ids: list[UUID] = Field(min_length=1, max_length=200)

    @field_validator("description")
    @classmethod
    def plain_description(cls, value):
        from app.shared.validation import reject_html

        return reject_html(value.strip())

    @field_validator("resource_ids")
    @classmethod
    def unique_resources(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Elige cada persona o espacio una sola vez")
        return value


class Window(StrictModel):
    start: str = Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    end: str = Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("El fin debe ser posterior al inicio, dentro del mismo día")
        return self


class Day(StrictModel):
    weekday: int = Field(ge=0, le=6)
    windows: list[Window] = Field(max_length=10)


class ExceptionDay(StrictModel):
    date: date
    windows: list[Window] = Field(max_length=10)


class AvailabilityDraft(StrictModel):
    weekly: list[Day] = Field(max_length=7)
    exceptions: list[ExceptionDay] = Field(max_length=366)

    @model_validator(mode="after")
    def distinct(self):
        if len({d.weekday for d in self.weekly}) != len(self.weekly) or len(
            {d.date for d in self.exceptions}
        ) != len(self.exceptions):
            raise ValueError("No repitas días en la disponibilidad")
        for day in [*self.weekly, *self.exceptions]:
            windows = sorted(day.windows, key=lambda w: w.start)
            if any(a.end > b.start for a, b in zip(windows, windows[1:], strict=False)):
                raise ValueError("Los horarios de atención no deben cruzarse")
        return self


class AvailabilityWrite(AvailabilityDraft):
    expected_version: int = Field(ge=0)


class PreviewPage(StrictModel):
    mode: Literal["appointments", "tables"] = "appointments"
    horizon_days: int = Field(default=30, ge=1, le=366)
    notice_minutes: int = Field(default=120, ge=0, le=525600)
    slot_minutes: int = Field(default=15, ge=5, le=120)
    manage_cutoff_hours: int = Field(default=24, ge=0, le=720)


class PreviewAvailability(AvailabilityDraft):
    resource_id: UUID


class BookingPreviewRequest(StrictModel):
    """Unsaved booking settings rendered as the public page for the owner."""

    page: PreviewPage | None = None
    availability: PreviewAvailability | None = None
    service_id: UUID | None = None
    resource_id: UUID | None = None
    day: date | None = None



class PublicSelection(StrictModel):
    page_token: str = Field(min_length=1, max_length=2000)
    service_id: UUID
    resource_id: UUID


class BookingWrite(PublicSelection):
    starts_at: datetime
    name: str = Field(min_length=1, max_length=160)
    phone: str = Field(min_length=7, max_length=30, pattern=r"^[+0-9 ()-]+$")
    identity_token: str | None = Field(default=None, max_length=2500)

    @field_validator("name", "phone")
    @classmethod
    def plain(cls, value):
        from app.shared.validation import reject_html

        value = reject_html(value.strip())
        if not value:
            raise ValueError("Completa tus datos para reservar")
        return value

    @field_validator("starts_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Elige un horario disponible")
        return value


class ManageRead(StrictModel):
    token: str = Field(min_length=1, max_length=2500)


class ManageWrite(ManageRead):
    expected_version: int = Field(ge=1)
    action: str = Field(pattern=r"^(cancel|reschedule)$")
    starts_at: datetime | None = None

    @field_validator("starts_at")
    @classmethod
    def aware(cls, value):
        if value and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Elige un horario disponible")
        return value


class LinkCustomer(StrictModel):
    expected_version: int = Field(ge=1)
    customer_id: UUID


class InviteWrite(StrictModel):
    customer_id: UUID


class MemberGrant(StrictModel):
    menu_token: str = Field(min_length=1, max_length=1500)
    page_token: str = Field(min_length=1, max_length=2000)


class VersionWrite(StrictModel):
    expected_version: int = Field(ge=1)


class PublicService(BaseModel):
    id: UUID
    name: str
    description: str
    duration_minutes: int
    resource_ids: list[UUID]


class PublicResource(BaseModel):
    id: UUID
    name: str
    timezone: str


class PublicContext(BaseModel):
    business_name: str
    branch_name: str
    services: list[PublicService]
    resources: list[PublicResource]
    horizon_days: int
    manage_cutoff_hours: int
    mode: Literal["appointments", "tables"] = "appointments"
    timezone: str | None = None


class PublicSlot(BaseModel):
    starts_at: datetime
    ends_at: datetime
    timezone: str


class PublicSlots(BaseModel):
    items: list[PublicSlot]


class BookingReceipt(BaseModel):
    calendar_uid: str
    title: str
    resource_name: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    status: str
    version: int
    can_manage: bool
    manage_path: str | None = None


class StaffBookingReschedule(StrictModel):
    expected_version: int = Field(ge=1)
    starts_at: datetime

    @field_validator("starts_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Incluye la zona horaria de la cita")
        return value


TableStatus = Literal[
    "requested", "confirmed", "seated", "completed", "declined", "cancelled", "no_show"
]


class TableRequestWrite(StrictModel):
    page_token: str = Field(min_length=1, max_length=2000)
    starts_at: datetime
    party_size: int = Field(ge=1, le=50)
    name: str = Field(min_length=1, max_length=160)
    phone: str = Field(min_length=7, max_length=30, pattern=r"^[+0-9 ()-]+$")
    identity_token: str | None = Field(default=None, max_length=2500)

    @field_validator("starts_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Elige una hora de llegada")
        return value

    @field_validator("name", "phone")
    @classmethod
    def plain(cls, value):
        from app.shared.validation import reject_html

        value = reject_html(value.strip())
        if not value:
            raise ValueError("Completa tus datos para solicitar una mesa")
        return value


class TableAction(StrictModel):
    expected_version: int = Field(ge=1)
    action: Literal["confirm", "decline", "cancel", "seat", "release", "no_show", "revoke"]
    resource_id: UUID | None = None

    @model_validator(mode="after")
    def selected_table(self):
        if self.action == "confirm" and self.resource_id is None:
            raise ValueError("Elige la mesa que vas a confirmar")
        if self.action != "confirm" and self.resource_id is not None:
            raise ValueError("La mesa se asigna al confirmar")
        return self


class TableArrival(BaseModel):
    starts_at: datetime
    timezone: str


class TableArrivals(BaseModel):
    items: list[TableArrival]


class TableReceipt(BaseModel):
    title: str = "Reserva de mesa"
    starts_at: datetime
    timezone: str
    party_size: int
    resource_name: str | None
    status: TableStatus
    version: int
    can_manage: bool
    calendar_uid: str
    manage_path: str | None = None


class TableHistoryItem(BaseModel):
    action: str
    starts_at: datetime
    status: TableStatus
    created_at: datetime


class TableSummary(TableReceipt):
    id: UUID
    name: str
    phone: str
    resource_id: UUID | None
    customer_id: UUID | None
    seated_at: datetime | None
    released_at: datetime | None


class TableDetail(TableSummary):
    history: list[TableHistoryItem]


class TableList(BaseModel):
    items: list[TableSummary]
    has_more: bool


class PreviewSelection(BaseModel):
    service_id: UUID
    resource_id: UUID
    day: date


class BookingPreview(BaseModel):
    context: PublicContext
    selection: PreviewSelection | None
    slots: list[PublicSlot]

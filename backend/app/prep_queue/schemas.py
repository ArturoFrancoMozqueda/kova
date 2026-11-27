from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.validation import StrictModel, reject_html

QueueStatus = Literal["received", "preparing", "ready", "delivered"]


def _clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = reject_html(value.strip())
    if not value:
        raise ValueError("Escribe el nombre de la estación")
    return value


class StationCreate(StrictModel):
    name: str = Field(min_length=1, max_length=60)
    alert_minutes: int = Field(default=8, ge=1, le=240)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return _clean_name(value)


class StationUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    alert_minutes: int | None = Field(default=None, ge=1, le=240)
    position: int | None = Field(default=None, ge=0, le=1000)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        return _clean_name(value)


class StationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    alert_minutes: int
    position: int
    is_active: bool


class TicketStatusChange(StrictModel):
    version: int = Field(gt=0)
    status: QueueStatus


class QueueItem(BaseModel):
    product_name: str
    quantity: int
    modifiers: list[str] = Field(default_factory=list)
    note: str | None = None


class QueueCard(BaseModel):
    # sale: a counter sale's ticket; customer_order: a pedido shown with its own status.
    kind: Literal["sale", "customer_order"]
    id: UUID
    station_id: UUID
    status: QueueStatus
    version: int
    number: int | None = None
    folio: str | None = None
    customer_name: str | None = None
    sale_order_id: UUID | None = None
    # Pedidos only: whether the sale is paid, and the promised time.
    payment_status: str | None = None
    promised_at: datetime | None = None
    received_at: datetime
    preparing_at: datetime | None = None
    ready_at: datetime | None = None
    delivered_at: datetime | None = None
    items: list[QueueItem]


class QueueResponse(BaseModel):
    stations: list[StationResponse]
    cards: list[QueueCard]
    generated_at: datetime

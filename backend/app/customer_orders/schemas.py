from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.orders.schemas import OrderResponse, PaymentCreate
from app.shared.validation import MAX_MODIFIER_OPTIONS, MAX_ORDER_ITEMS, StrictModel, reject_html

CustomerOrderStatus = Literal["new", "confirmed", "in_progress", "ready", "fulfilled", "cancelled"]
PaymentStatus = Literal["unpaid", "paid", "partially_refunded", "refunded", "voided"]
FulfillmentType = Literal["pickup", "delivery"]
SourceChannel = Literal["counter", "phone_whatsapp", "other"]


class CustomerOrderItemCreate(StrictModel):
    product_id: UUID
    quantity: int = Field(gt=0, le=100_000)
    modifier_option_ids: list[UUID] = Field(default_factory=list, max_length=MAX_MODIFIER_OPTIONS)
    note: str | None = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str | None) -> str | None:
        return reject_html(value.strip() or None if value else None)


class CustomerOrderItemUpdate(CustomerOrderItemCreate):
    id: UUID | None = None


class _CustomerOrderFields(StrictModel):
    fulfillment_type: FulfillmentType = "pickup"
    source_channel: SourceChannel = "counter"
    customer_name: str | None = Field(default=None, max_length=160)
    customer_phone: str | None = Field(default=None, max_length=32)
    delivery_address: str | None = Field(default=None, max_length=300)
    delivery_reference: str | None = Field(default=None, max_length=200)
    promised_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator(
        "customer_name", "delivery_address", "delivery_reference", "note", mode="before"
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return reject_html(value.strip()) or None
        return value

    @field_validator("customer_phone", mode="before")
    @classmethod
    def validate_phone(cls, value: object) -> object:
        if not isinstance(value, str) or not value.strip():
            return None
        normalized = value.strip()
        digits = "".join(ch for ch in normalized if ch.isdigit())
        if len(digits) < 7 or len(digits) > 15:
            raise ValueError("El teléfono debe contener entre 7 y 15 dígitos")
        return normalized

    @model_validator(mode="after")
    def validate_delivery(self):
        if self.fulfillment_type == "delivery":
            if not self.customer_name:
                raise ValueError("El nombre del cliente es obligatorio para entrega")
            if not self.delivery_address:
                raise ValueError("La dirección es obligatoria para entrega")
        return self


class CustomerOrderCreate(_CustomerOrderFields):
    items: list[CustomerOrderItemCreate] = Field(min_length=1, max_length=MAX_ORDER_ITEMS)


class CustomerOrderUpdate(_CustomerOrderFields):
    version: int = Field(gt=0)
    items: list[CustomerOrderItemUpdate] = Field(min_length=1, max_length=MAX_ORDER_ITEMS)


class VersionedAction(StrictModel):
    version: int = Field(gt=0)


class CustomerOrderStatusChange(VersionedAction):
    status: CustomerOrderStatus


class CustomerOrderCancel(VersionedAction):
    reason: Literal["customer_request", "out_of_stock", "duplicate", "other"]
    note: str | None = Field(default=None, max_length=300)

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str | None) -> str | None:
        return reject_html(value.strip() or None if value else None)


class CustomerOrderCheckout(VersionedAction):
    payments: list[PaymentCreate] = Field(min_length=1, max_length=10)


class CustomerOrderModifierResponse(BaseModel):
    id: UUID
    modifier_group_id: UUID
    modifier_group_name: str
    modifier_option_id: UUID
    modifier_option_name: str
    price_delta_amount: Decimal


class CustomerOrderItemResponse(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal
    note: str | None
    modifier_option_ids: list[UUID]
    modifiers: list[CustomerOrderModifierResponse]


class CustomerOrderResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    folio: str
    status: CustomerOrderStatus
    payment_status: PaymentStatus
    fulfillment_type: FulfillmentType
    source_channel: SourceChannel
    customer_name: str | None
    customer_phone: str | None
    delivery_address: str | None
    delivery_reference: str | None
    promised_at: datetime | None
    note: str | None
    subtotal_amount: Decimal
    total_amount: Decimal
    sale_order_id: UUID | None
    version: int
    stock_conflict: bool
    items: list[CustomerOrderItemResponse]
    confirmed_at: datetime | None
    ready_at: datetime | None
    fulfilled_at: datetime | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    cancellation_note: str | None
    created_at: datetime
    updated_at: datetime


class CustomerOrderListItem(BaseModel):
    id: UUID
    folio: str
    status: CustomerOrderStatus
    payment_status: PaymentStatus
    fulfillment_type: FulfillmentType
    customer_name: str | None
    customer_phone: str | None
    promised_at: datetime | None
    total_amount: Decimal
    stock_conflict: bool
    created_at: datetime
    updated_at: datetime


class CustomerOrderListResponse(BaseModel):
    items: list[CustomerOrderListItem]
    total: int
    limit: int
    offset: int
    status_counts: dict[str, int]


class CustomerOrderCheckoutResponse(BaseModel):
    customer_order: CustomerOrderResponse
    sale_order: OrderResponse

from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.shared.validation import StrictModel


class QuoteItemCreate(StrictModel):
    product_id: UUID
    quantity: int = Field(ge=1, le=100000)


class QuoteCreate(StrictModel):
    customer_id: UUID
    opportunity_id: UUID | None = None
    expires_at: datetime
    items: list[QuoteItemCreate] = Field(min_length=1, max_length=100)

    @field_validator("expires_at")
    @classmethod
    def valid_expiration(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("La vigencia debe incluir zona horaria")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def unique_products(self):
        ids = [item.product_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("No repitas productos en la cotización")
        return self


class QuoteAction(StrictModel):
    expected_version: int = Field(ge=1)


class QuoteShared(QuoteAction):
    confirmed_shared: Literal[True]


class QuoteAccept(QuoteAction):
    confirmed_customer_acceptance: Literal[True]


class QuoteItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal


class QuoteResponse(BaseModel):
    id: UUID
    folio: str
    status: Literal["draft", "sent", "accepted", "expired", "cancelled"]
    customer_id: UUID
    opportunity_id: UUID | None = None
    customer_name: str
    expires_at: datetime
    items: list[QuoteItemResponse]
    total_amount: Decimal
    version: int
    customer_order_id: UUID | None
    created_at: datetime
    updated_at: datetime


class QuoteList(BaseModel):
    items: list[QuoteResponse]
    total: int


class QuoteJourney(BaseModel):
    quote_id: UUID
    catalog_request_id: UUID | None
    opportunity_id: UUID | None
    opportunity_stage: str | None
    customer_order_id: UUID | None
    customer_order_status: str | None
    sale_order_id: UUID | None
    sale_status: Literal["completed", "voided"] | None
    sale_total_amount: Decimal | None
    recorded_payments_amount: Decimal | None
    # Payment records describe POS entries; they do not certify a PSP settlement.
    external_collection_verified: Literal[False] = False

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.shared.validation import StrictModel, reject_html


class CustomerWrite(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=30, pattern=r"^[+0-9 ()-]+$")
    is_active: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def safe_name(cls, value):
        return reject_html(value)

    @field_validator("email", "phone", mode="before")
    @classmethod
    def clean_contact(cls, value):
        return value.strip() or None if isinstance(value, str) else value


class CustomerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    email: str | None
    phone: str | None
    is_active: bool
    created_at: datetime


class CustomerPurchase(BaseModel):
    id: UUID
    branch_id: UUID
    occurred_at: datetime
    status: str
    total_amount: Decimal
    refunded_amount: Decimal


class CustomerHistory(BaseModel):
    customer: CustomerResponse
    purchases: list[CustomerPurchase]
    limit: int
    offset: int
    has_more: bool

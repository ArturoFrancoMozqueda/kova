from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.orders.schemas import OrderCreate, OrderItemCreate
from app.shared.validation import MAX_ORDER_ITEMS, StrictModel, reject_html

CouponKind = Literal["percent", "amount"]


def _normalize_code(value: str) -> str:
    return value.strip().upper()


class _CouponRules(StrictModel):
    description: str | None = Field(default=None, max_length=160)
    value: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    min_purchase: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(default=None, gt=0, le=1_000_000)
    max_uses_per_customer: int | None = Field(default=None, gt=0, le=1000)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        return reject_html(value.strip() or None if value else None)

    @model_validator(mode="after")
    def window(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("La fecha final debe ser posterior a la inicial")
        return self


class CouponCreate(_CouponRules):
    # Letters, digits, "-" or "_"; stored in capitals (verano25 → VERANO25).
    code: str = Field(
        min_length=3, max_length=32, pattern=r"^\s*[A-Za-z0-9][A-Za-z0-9_-]{2,31}\s*$"
    )
    kind: CouponKind

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return _normalize_code(value)

    @model_validator(mode="after")
    def percent_range(self):
        if self.kind == "percent" and self.value > 100:
            raise ValueError("Un porcentaje no puede pasar de 100")
        return self


class CouponUpdate(StrictModel):
    version: int = Field(gt=0)
    description: str | None = Field(default=None, max_length=160)
    value: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    min_purchase: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(default=None, gt=0, le=1_000_000)
    max_uses_per_customer: int | None = Field(default=None, gt=0, le=1000)
    is_active: bool | None = None


class CouponResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    description: str | None
    kind: CouponKind
    value: Decimal
    min_purchase: Decimal | None
    starts_at: datetime | None
    ends_at: datetime | None
    max_uses: int | None
    max_uses_per_customer: int | None
    is_active: bool
    version: int
    uses: int = 0
    created_at: datetime


class CouponCart(BaseModel):
    """The cart being charged: enough to price a preview before payment."""

    customer_id: UUID | None = None
    items: list[OrderItemCreate] = Field(min_length=1, max_length=MAX_ORDER_ITEMS)


class CouponPreview(StrictModel):
    code: str = Field(min_length=1, max_length=40)
    order: CouponCart


class CouponPreviewResponse(BaseModel):
    coupon: CouponResponse
    subtotal_amount: Decimal
    discount_amount: Decimal


class CouponCheckout(StrictModel):
    code: str = Field(min_length=1, max_length=40)
    order: OrderCreate
    # The discount the cashier saw; a different server result asks to review.
    expected_discount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)

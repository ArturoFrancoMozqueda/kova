from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class OrderItemCreate(BaseModel):
    product_id: UUID
    quantity: int = Field(gt=0)


class PaymentCreate(BaseModel):
    method: str = Field(pattern="^(cash|bank_transfer|manual_card)$")
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    amount_tendered: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    reference: str | None = Field(default=None, max_length=255)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    payment: PaymentCreate

    @model_validator(mode="after")
    def validate_single_payment(self) -> "OrderCreate":
        if self.payment.method == "cash" and self.payment.amount_tendered is None:
            raise ValueError("Cash payment requires amount_tendered")
        return self


class OrderItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    method: str
    amount_amount: Decimal
    amount_tendered_amount: Decimal | None
    change_due_amount: Decimal
    reference: str | None


class OrderResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    status: str
    subtotal_amount: Decimal
    total_amount: Decimal
    items: list[OrderItemResponse]
    payment: PaymentResponse
